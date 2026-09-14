use std::sync::Arc;

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::header::{CONNECTION, CONTENT_TYPE};
use hyper::Response;
use serde_json::json;
use tracing::warn;

use super::super::constants::{
    html_error, html_escape, html_link_notice, html_notice, html_redirect_notice, url_decode,
    HTML_SUCCESS, REDIRECT_PATH,
};
use super::super::manager::AuthManager;
use super::super::token::classify_auth_failure;
use super::super::types::{AuthError, AuthState};

/// Build a callback response. Every response closes its connection: a browser
/// must never reuse a connection owned by an older flow for the next one,
/// otherwise hyper serves it with that flow's stale service closure and the
/// legitimate callback is answered as expired.
fn html_response(status: u16, html: String) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(CONNECTION, "close")
        .body(Full::new(Bytes::from(html)))
        .unwrap()
}

/// Calm 200 page for a tab that cannot be exchanged. When a live login is
/// pending, forward the browser to it; after the forward bounces back (loop
/// guard), fall back to a manual link so navigation cannot spin.
fn notice_response(
    title: &str,
    message: &str,
    auto_redirect: Option<String>,
    manual_link: Option<String>,
) -> Response<Full<Bytes>> {
    let html = match (auto_redirect, manual_link) {
        (Some(url), _) if !url.is_empty() => html_redirect_notice(
            title,
            &format!("{message} Taking you to the current login…"),
            &url,
        ),
        (_, Some(url)) if !url.is_empty() => html_link_notice(
            title,
            &format!("{message} Open the current login with the link below."),
            &url,
        ),
        _ => html_notice(title, message),
    };
    html_response(200, html)
}

/// Extract the `state` query parameter from an authorization URL.
fn authorize_state(url: &str) -> Option<&str> {
    let rest = url.split("state=").nth(1)?;
    Some(rest.split('&').next().unwrap_or(rest))
}

/// Choose how a stale tab is forwarded: automatic for the first attempts, a
/// manual link afterwards. The cap breaks redirect loops when the forwarded
/// URL immediately bounces back to the callback. The target must carry the
/// state of the live transaction, otherwise forwarding would loop through
/// Spotify forever.
async fn forward_target(
    auth_mgr: &AuthManager,
    received_state: &str,
    active_url: Option<String>,
) -> (Option<String>, Option<String>, u32) {
    let live_state = auth_mgr
        .state
        .lock()
        .await
        .pkce
        .as_ref()
        .map(|pkce| pkce.state.clone());
    let Some(url) = active_url.filter(|url| {
        !url.is_empty()
            && live_state
                .as_deref()
                .is_some_and(|live| authorize_state(url) == Some(live))
    }) else {
        return (None, None, 0);
    };
    let hits = auth_mgr.note_callback_redirect(received_state).await;
    if hits <= 2 {
        (Some(url), None, hits)
    } else {
        (None, Some(url), hits)
    }
}

/// Handle the user denying the authorization on Spotify's page. The PKCE
/// transaction is already claimed by the caller.
async fn denied_response(auth_mgr: &AuthManager, state: &str, err: &str) -> Response<Full<Bytes>> {
    let auth_error = AuthError::OAuth(err.to_string());
    let snap = {
        let mut current = auth_mgr.state.lock().await;
        current.state = if current.current.is_some() {
            AuthState::Authenticated
        } else {
            AuthState::Unauthenticated
        };
        current.last_auth_url = None;
        auth_mgr.snapshot_locked(&current, None)
    };
    if let Ok(value) = serde_json::to_value(&snap) {
        auth_mgr.emit("auth.changed", value).await;
    }
    auth_mgr
        .emit(
            "auth.failed",
            json!({ "reason": "other", "message": auth_error.to_string() }),
        )
        .await;
    auth_mgr.close_listener_if_owner(state).await;
    html_response(400, html_error("Authorization Rejected", &html_escape(err)))
}

pub(super) async fn handle_callback(
    auth_mgr: Arc<AuthManager>,
    port: u16,
    req: hyper::Request<hyper::body::Incoming>,
    expected_state: &str,
    claimed_tx: tokio::sync::mpsc::Sender<()>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    if req.method() != hyper::Method::GET {
        return Ok(html_response(
            405,
            html_error(
                "Method Not Allowed",
                "Only GET is allowed for the OAuth callback",
            ),
        ));
    }
    if req.uri().path() != REDIRECT_PATH && req.uri().path() != "/login" {
        return Ok(html_response(
            404,
            html_error("Not Found", "Invalid callback path"),
        ));
    }
    let q = req.uri().query().unwrap_or("").to_string();
    let params: std::collections::HashMap<String, String> = url_decode(&q);
    let state = params.get("state").cloned().unwrap_or_default();
    let code = params.get("code").cloned().unwrap_or_default();
    let has_error = params.contains_key("error");

    if !has_error && code.trim().is_empty() {
        return Ok(html_response(
            400,
            html_error(
                "Authorization Failed",
                "Spotify did not return an authorization code. Return to Spotoei and retry.",
            ),
        ));
    }

    // Atomically claim the live transaction. This works no matter which
    // connection or listener accepted the request, so keep-alive connection
    // reuse or a stale listener can never reject a legitimate callback.
    if let Some((flow_seen, pkce)) = auth_mgr.claim_pkce(&state).await {
        // This connection's listener owns the claimed flow: close it now so
        // its 5-minute timeout cannot fire and the port is freed. A request
        // that arrived on an older connection is closed by ownership instead.
        if state == expected_state {
            let _ = claimed_tx.try_send(());
        }
        if let Some(err) = params.get("error") {
            return Ok(denied_response(&auth_mgr, &state, err).await);
        }
        let result = auth_mgr
            .complete_claimed_flow(flow_seen, pkce, &code, port)
            .await;
        // The transaction is finished either way: free the loopback port
        // unless a newer login already replaced the listener.
        auth_mgr.close_listener_if_owner(&state).await;
        return Ok(match &result {
            Ok(()) => html_response(200, HTML_SUCCESS.to_string()),
            Err(AuthError::Superseded) => {
                warn!("auth callback superseded before completion; acknowledging stale tab");
                let status = auth_mgr.status().await;
                let (auto, manual, _) = forward_target(&auth_mgr, &state, status.auth_url).await;
                notice_response(
                    "Login Already Handled",
                    "This login was already completed or replaced by a newer request.",
                    auto,
                    manual,
                )
            }
            Err(error) => {
                warn!(error = %error, "auth complete flow failed");
                let (reason, message) = classify_auth_failure(error);
                auth_mgr
                    .emit(
                        "auth.failed",
                        json!({ "reason": reason, "message": message }),
                    )
                    .await;
                html_response(
                    400,
                    html_error(
                        "Authorization Failed",
                        "Spotoei could not finish the token exchange. Return to the terminal for details and retry.",
                    ),
                )
            }
        });
    }

    // Not claimable: either already handled by another tab, or a tab from an
    // earlier app run. A tab from a flow this app already completed or
    // replaced is stale, not hostile: answer it with a calm notice.
    let recognized = if state.is_empty() {
        false
    } else {
        auth_mgr.state.lock().await.is_recent_state(&state)
    };
    if recognized {
        let status = auth_mgr.status().await;
        let (auto, manual, _) = forward_target(&auth_mgr, &state, status.auth_url).await;
        return Ok(notice_response(
            "Login Already Handled",
            "This login was already completed or replaced by a newer request.",
            auto,
            manual,
        ));
    }
    // Every real Spotify redirect carries a code or an error. If it cannot be
    // claimed, the tab belongs to an earlier run (or an evicted flow) and can
    // never be exchanged: acknowledge it calmly. No token exchange happens.
    if has_error || !code.trim().is_empty() {
        let status = auth_mgr.status().await;
        let (title, message) = if status.state == AuthState::Authenticated {
            (
                "Login Already Handled",
                "Spotoei is already connected. This tab belonged to an earlier login — you can close it and return to the terminal.",
            )
        } else {
            (
                "Login Tab Expired",
                "This login tab is no longer active. Return to the terminal and press [A] to start a new login.",
            )
        };
        let url_state = status
            .auth_url
            .as_deref()
            .and_then(authorize_state)
            .map(str::to_string);
        let (auto, manual, hits) = forward_target(&auth_mgr, &state, status.auth_url).await;
        warn!(
            received_state = %state,
            expected_state = %expected_state,
            auth_state = ?status.state,
            pending = status.pending,
            url_state = ?url_state,
            redirect_hits = hits,
            auto_state = ?auto.as_deref().and_then(authorize_state),
            manual_state = ?manual.as_deref().and_then(authorize_state),
            "OAuth callback does not match the live login"
        );
        return Ok(notice_response(title, message, auto, manual));
    }
    warn!(
        received_state = %state,
        expected_state = %expected_state,
        "OAuth callback without an authorization code; ignoring bogus request"
    );
    Ok(html_response(
        400,
        html_error("State Mismatch", "Invalid OAuth state parameter. This browser tab is stale — complete the login in the newest tab Spotoei opened."),
    ))
}
