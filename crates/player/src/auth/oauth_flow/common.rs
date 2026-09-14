use super::super::constants::KEYMASTER_CLIENT_ID;
use super::super::types::AuthFlow;

/// Decide how a completed PKCE callback is stored: which client the code
/// is exchanged for, and whether the token lands in the streaming store.
/// The flow recorded at `begin` time wins — never sniff URLs, so a Web
/// login stays a Web login even when the configured client is Keymaster.
pub const STREAMING_SCOPES: &str = "streaming user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-read-playback-position user-top-read user-read-recently-played user-read-private";

pub(in crate::auth) fn resolve_exchange_target(
    flow: AuthFlow,
    configured_client_id: &str,
) -> (String, bool) {
    match flow {
        AuthFlow::Streaming => (KEYMASTER_CLIENT_ID.to_string(), true),
        AuthFlow::Web => (configured_client_id.to_string(), false),
    }
}

/// Whether two account identities conflict. `None` means that an identity is
/// not known. Only two different, known account IDs conflict.
pub(in crate::auth) fn account_conflict(stored: Option<&str>, fresh: &str) -> bool {
    // "default" is a placeholder generated when /v1/me fails; it must never
    // be treated as a conflict with a known real account.
    matches!(stored, Some(id) if id != fresh && id != "default" && fresh != "default")
}

/// When /v1/me could not be reached (missing scope, rate-limiting, offline),
/// the Keymaster token exchange assigns "default". If an authenticated Web
/// session already exists, bind the streaming token to that known user instead
/// of leaving it orphaned under the placeholder.
pub(in crate::auth) fn reconcile_streaming_account<'a>(
    web_account: Option<&'a str>,
    streaming_account: &'a str,
) -> &'a str {
    if streaming_account == "default" {
        if let Some(web) = web_account {
            if !web.trim().is_empty() {
                return web;
            }
        }
    }
    streaming_account
}

pub(in crate::auth) fn should_upgrade_web_account(
    web_account: Option<&str>,
    resolved: &str,
) -> bool {
    web_account == Some("default") && resolved != "default"
}
