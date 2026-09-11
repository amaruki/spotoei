import { KEYMASTER_CLIENT_ID, resolveClientId, saveClientId } from '../config';
import { copyToClipboard, openBrowser } from '../system';
import type { Ui } from '../ui/types';
import type { AppContext } from './types';

type AuthUi = Pick<Ui, 'setStatus' | 'focusClientIdInput' | 'setStreamingPending'>;

async function openAuthUrl(
  ui: AuthUi | null,
  url: string,
  waitingFor: string,
  reopened: boolean,
): Promise<void> {
  const opened = await openBrowser(url);
  const copied = copyToClipboard(url);
  const action = reopened ? 're-opened' : 'opened';
  let msg = opened
    ? `Browser ${action} for ${waitingFor}! Complete it in the newest tab.`
    : `Browser could not open for ${waitingFor}. Open this URL: ${url}`;
  if (copied) msg += ' (URL copied to clipboard)';
  if (ui) ui.setStatus(msg, true);
}

export function createAuthActions(ctx: AppContext) {
  const { clients, getUi, state } = ctx;
  // Guards concurrent triggers (manual keypress racing the automatic
  // post-login trigger): the first call decides, the second returns. Without
  // this, two flows are minted, two tabs open, and completing either but the
  // newest is rejected as a state mismatch.
  let triggerInFlight = false;

  const triggerAuth = async (opts?: { streamingOnly?: boolean }): Promise<void> => {
    if (triggerInFlight) return;
    triggerInFlight = true;
    try {
      await triggerAuthInner(opts);
    } finally {
      triggerInFlight = false;
    }
  };

  const triggerAuthInner = async (opts?: { streamingOnly?: boolean }): Promise<void> => {
    const ui = getUi();
    const res = resolveClientId();
    if (!res.clientId) {
      if (ui) {
        ui.focusClientIdInput();
        ui.setStatus('Spotify Client ID not set! Enter it below and press Enter to save.', true);
      }
      return;
    }
    // A login is already waiting in the browser: re-open that same flow.
    // Minting a new flow here would orphan the open tab, and completing the
    // orphaned tab is rejected as a state mismatch.
    const pending = await clients.auth.status().catch(() => null);
    // `pending` is authoritative when the player reports it: any in-flight
    // PKCE transaction must be re-opened, never replaced by a second flow
    // (which would orphan the browser tab and answer it with a state error).
    const pendingFlow =
      pending?.pending ??
      (pending?.state === 'authenticating' || Boolean(ctx.state.currentInfo?.streamingPending));
    if (pending?.authUrl && pendingFlow) {
      if (pending.state === 'authenticated') {
        // A live flow on top of an authenticated session is the streaming
        // top-up; keep the onboarding screen waiting on it.
        ctx.state.currentInfo.streamingPending = true;
        if (ui) ui.setStreamingPending(true);
      }
      await openAuthUrl(ui, pending.authUrl, 'the pending login', true);
      return;
    }
    const isKeymaster = res.clientId === KEYMASTER_CLIENT_ID;
    const isWebAuthed = ctx.state.currentInfo?.auth?.state === 'authenticated';
    const hasStreaming =
      ctx.state.hasStreaming ?? (await clients.auth.streamingStatus().catch(() => false));
    ctx.state.hasStreaming = hasStreaming;
    if (opts?.streamingOnly && (!isWebAuthed || hasStreaming)) return;

    if (isWebAuthed && !hasStreaming) {
      if (ui) ui.setStatus('Opening browser for Audio Streaming permission (Step 2/2)...', true);
      try {
        const result = await clients.auth.beginStreaming();
        if (result.authUrl) {
          ui?.setStreamingPending(true);
          await openAuthUrl(ui, result.authUrl, 'Audio Streaming permission (Step 2/2)', false);
        }
      } catch (err) {
        if (ui)
          ui.setStatus(
            `Streaming auth error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
      }
      return;
    }

    const stepLabel = isKeymaster ? 'Spotify login' : 'Web API permission (Step 1/2)';
    if (ui) ui.setStatus(`Opening browser for ${stepLabel}...`, true);
    try {
      const result = await clients.auth.begin();
      if (result.authUrl) {
        await openAuthUrl(ui, result.authUrl, stepLabel, false);
      }
    } catch (err) {
      if (ui) ui.setStatus(`Auth error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };

  const triggerLogout = async (): Promise<void> => {
    const ui = getUi();
    if (ui) ui.setStatus('Logging out and clearing session...', true);
    try {
      try {
        await clients.playback.pause();
      } catch {
        void clients.webApi?.pause?.().catch(() => {});
      }
      await clients.auth.logout();
      state.currentInfo.playback = null;
      state.lastPlaybackState = 'idle';
      // The session that owned any pending streaming login is gone; a stale
      // pending flag would make the next press reopen a dead authorization tab.
      state.hasStreaming = false;
      state.currentInfo.streamingPending = false;
      if (ui) {
        ui.setStreamingPending(false);
        ui.setPlayback(null);
        ui.setRoute('onboarding');
        ui.setStatus('Logged out successfully. Press [A] or [Enter] to login again.', true);
      }
    } catch (err) {
      if (ui)
        ui.setStatus(`Logout error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };

  const handleSaveClientId = async (newClientId: string): Promise<void> => {
    const ui = getUi();
    try {
      const res = saveClientId(newClientId);
      await clients.auth.setClientId(newClientId);
      if (ui) {
        ui.setStatus(`Spotify Client ID saved to ${res.configPath}!`, true);
      }
    } catch (err) {
      if (ui) {
        ui.setStatus(
          `Failed to save Client ID: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    }
  };

  return { triggerAuth, triggerLogout, handleSaveClientId };
}
