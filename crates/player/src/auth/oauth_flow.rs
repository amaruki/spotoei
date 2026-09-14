//! OAuth Authorization Code + PKCE flow drivers.
//!
//! Split by phase so each file stays under the 300-line ceiling:
//! `common` holds the pure routing/reconciliation helpers, `begin` arms the
//! loopback listener and starts the Web and streaming logins, `mock` covers
//! the `SPOTOEI_MOCK_AUTH` shortcut, `logout` tears the session down, and
//! `complete` exchanges a claimed PKCE transaction for tokens.

mod begin;
mod common;
mod complete;
mod logout;
mod mock;

pub use common::STREAMING_SCOPES;
pub(super) use common::{
    account_conflict, reconcile_streaming_account, resolve_exchange_target,
    should_upgrade_web_account,
};
