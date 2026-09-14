use serde_json::Value;
use std::sync::Arc;

use crate::auth::{AuthError, AuthManager};
use crate::protocol::{err, ok, Command, ErrorBody, ErrorCode};

pub async fn dispatch(command: &str, cmd: &Command, auth: &Arc<AuthManager>) -> String {
    match command {
        "auth.status" => {
            let st = auth.status().await;
            ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null))
        }
        "auth.begin" => {
            let scopes = cmd
                .data
                .get("scopes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.as_str().map(String::from))
                        .collect()
                });
            match auth.begin(scopes).await {
                Ok(st) => ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null)),
                Err(AuthError::MissingClientId) => err(
                    &cmd.id,
                    ErrorBody::new(
                        ErrorCode::InvalidRequest,
                        "missing SPOTOEI_CLIENT_ID configuration",
                    ),
                ),
                Err(e) => err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::AuthFailed, format!("auth.begin failed: {e}")),
                ),
            }
        }
        "auth.begin_streaming" => match auth.begin_streaming().await {
            Ok(st) => ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null)),
            Err(e) => err(
                &cmd.id,
                ErrorBody::new(
                    ErrorCode::AuthFailed,
                    format!("auth.begin_streaming failed: {e}"),
                ),
            ),
        },
        "auth.streaming_status" => {
            let has_streaming = auth.has_streaming_session().await;
            ok(
                &cmd.id,
                serde_json::json!({ "authenticated": has_streaming }),
            )
        }
        "auth.logout" => match auth.logout().await {
            Ok(st) => ok(&cmd.id, serde_json::to_value(&st).unwrap_or(Value::Null)),
            Err(e) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::AuthFailed, format!("auth.logout failed: {e}")),
            ),
        },
        "auth.get_web_token" => match auth.get_web_token().await {
            Ok((token, expires_at)) => ok(
                &cmd.id,
                serde_json::json!({
                    "accessToken": token,
                    "expiresAt": expires_at,
                }),
            ),
            Err(AuthError::NotAuthenticated) => err(
                &cmd.id,
                ErrorBody::new(ErrorCode::AuthRequired, "not authenticated"),
            ),
            Err(e) => err(
                &cmd.id,
                ErrorBody::new(
                    ErrorCode::AuthFailed,
                    format!("token fetch/refresh failed: {e}"),
                ),
            ),
        },
        "auth.invalidate_token" => {
            auth.invalidate_token().await;
            ok(&cmd.id, serde_json::json!({ "ok": true }))
        }
        "auth.set_client_id" => {
            let id = cmd
                .data
                .get("clientId")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .to_string();
            if id.is_empty() {
                err(
                    &cmd.id,
                    ErrorBody::new(ErrorCode::InvalidRequest, "clientId cannot be empty"),
                )
            } else {
                auth.set_client_id(id.clone()).await;
                ok(&cmd.id, serde_json::json!({ "ok": true, "clientId": id }))
            }
        }
        _ => err(
            &cmd.id,
            ErrorBody::new(
                ErrorCode::InvalidRequest,
                format!("unknown command: {command}"),
            ),
        ),
    }
}
