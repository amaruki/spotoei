//! Recovery from dead playback credentials.
//!
//! Spotify sometimes rejects the cached access token on the playback and
//! Connect services (`INVALID_CREDENTIALS`) while the Web API still accepts
//! it. Playing then fails silently: the receiver never registers and every
//! track is skipped as unloadable. This module decides when the engine
//! should throw the token away, fetch a fresh one, and reconnect — exactly
//! once per incident instead of failing silent or looping forever.

/// Failures back-to-back within this window count as one incident: a single
/// unloadable track is usually region blocking, everything failing at once
/// is a dead token.
pub const UNAVAILABLE_WINDOW_MS: u64 = 60_000;

/// Minimum failures inside the window before reconnecting.
pub const UNAVAILABLE_STREAK_LIMIT: u32 = 2;

/// Minimum gap between two automatic reconnects.
pub const RECONNECT_COOLDOWN_MS: u64 = 5 * 60 * 1000;

/// True when a librespot error means the token itself is dead for playback:
/// an unauthenticated session, or the login layer reporting invalid
/// credentials (surfaced as `FailedPrecondition(FaultyRequest(..))`).
pub fn is_credentials_error(err: &librespot::core::Error) -> bool {
    use librespot::core::error::ErrorKind;
    if err.kind == ErrorKind::Unauthenticated {
        return true;
    }
    let s = format!("{err:?}");
    s.contains("INVALID_CREDENTIALS") || s.contains("BAD_REQUEST") || s.contains("BadCredentials")
}

/// Tracks consecutive unloadable tracks and decides when to reconnect.
#[derive(Debug, Default)]
pub struct UnavailableTracker {
    streak: u32,
    last_ms: Option<u64>,
    last_reconnect_ms: Option<u64>,
}

impl UnavailableTracker {
    /// Record one unloadable track at `now_ms`. Returns true exactly when
    /// the engine should reconnect with a fresh token.
    pub fn note_unavailable(&mut self, now_ms: u64) -> bool {
        match self.last_ms {
            Some(last) if now_ms.saturating_sub(last) <= UNAVAILABLE_WINDOW_MS => {
                self.streak = self.streak.saturating_add(1);
            }
            _ => self.streak = 1,
        }
        self.last_ms = Some(now_ms);
        if self.streak < UNAVAILABLE_STREAK_LIMIT {
            return false;
        }
        match self.last_reconnect_ms {
            Some(last) if now_ms.saturating_sub(last) < RECONNECT_COOLDOWN_MS => false,
            _ => {
                self.last_reconnect_ms = Some(now_ms);
                self.streak = 0;
                true
            }
        }
    }

    /// Any audible playback proves the token works; start over.
    pub fn note_playing(&mut self) {
        self.streak = 0;
    }
}

/// Millis since the Unix epoch for tracker timestamps.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_error(
        kind: librespot::core::error::ErrorKind,
        message: &str,
    ) -> librespot::core::Error {
        librespot::core::Error::new(kind, std::io::Error::other(message))
    }

    #[test]
    fn unauthenticated_session_is_a_credentials_error() {
        let err = core_error(
            librespot::core::error::ErrorKind::Unauthenticated,
            "no valid authentication credentials",
        );
        assert!(is_credentials_error(&err));
    }

    #[test]
    fn invalid_credentials_login_failure_is_a_credentials_error() {
        let err = core_error(
            librespot::core::error::ErrorKind::FailedPrecondition,
            "FaultyRequest(INVALID_CREDENTIALS)",
        );
        assert!(is_credentials_error(&err));
    }

    #[test]
    fn bad_request_and_bad_credentials_are_credentials_errors() {
        let err_bad_req = core_error(
            librespot::core::error::ErrorKind::FailedPrecondition,
            "FaultyRequest(BAD_REQUEST)",
        );
        assert!(is_credentials_error(&err_bad_req));

        let err_bad_creds = core_error(
            librespot::core::error::ErrorKind::FailedPrecondition,
            "BadCredentials",
        );
        assert!(is_credentials_error(&err_bad_creds));
    }

    #[test]
    fn unrelated_errors_are_not() {
        let err = core_error(
            librespot::core::error::ErrorKind::NotFound,
            "Requested entity was not found",
        );
        assert!(!is_credentials_error(&err));
    }

    #[test]
    fn single_unloadable_track_does_not_reconnect() {
        let mut tracker = UnavailableTracker::default();
        assert!(!tracker.note_unavailable(1_000));
    }

    #[test]
    fn back_to_back_failures_trigger_one_reconnect() {
        let mut tracker = UnavailableTracker::default();
        assert!(!tracker.note_unavailable(1_000));
        assert!(tracker.note_unavailable(2_000));
    }

    #[test]
    fn failures_far_apart_are_separate_incidents() {
        let mut tracker = UnavailableTracker::default();
        assert!(!tracker.note_unavailable(1_000));
        assert!(!tracker.note_unavailable(1_000 + UNAVAILABLE_WINDOW_MS + 1));
    }

    #[test]
    fn reconnect_is_cooled_down_after_triggering() {
        let mut tracker = UnavailableTracker::default();
        assert!(!tracker.note_unavailable(1_000));
        assert!(tracker.note_unavailable(2_000));
        assert!(!tracker.note_unavailable(3_000));
        assert!(!tracker.note_unavailable(4_000));
    }

    #[test]
    fn cooldown_expiry_allows_reconnect_again() {
        let mut tracker = UnavailableTracker::default();
        assert!(!tracker.note_unavailable(1_000));
        assert!(tracker.note_unavailable(2_000));
        let later = 2_000 + RECONNECT_COOLDOWN_MS + 1;
        assert!(!tracker.note_unavailable(later));
        assert!(tracker.note_unavailable(later + 1_000));
    }

    #[test]
    fn audible_playback_resets_the_streak() {
        let mut tracker = UnavailableTracker::default();
        assert!(!tracker.note_unavailable(1_000));
        tracker.note_playing();
        assert!(!tracker.note_unavailable(2_000));
    }
}
