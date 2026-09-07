import { resolveClientId, saveClientId } from '../config';
import { copyToClipboard, openBrowser } from '../system';
import type { AppContext } from './types';

export function createAuthActions(ctx: AppContext) {
  const { clients, getUi } = ctx;

  const triggerAuth = async (): Promise<void> => {
    const ui = getUi();
    const res = resolveClientId();
    if (!res.clientId) {
      if (ui) {
        ui.focusClientIdInput();
        ui.setStatus('Spotify Client ID not set! Enter it below and press Enter to save.', true);
      }
      return;
    }
    const isWebAuthed = ctx.state.currentInfo?.auth?.state === 'authenticated';
    const hasStreaming = await clients.auth.streamingStatus().catch(() => false);

    if (isWebAuthed && !hasStreaming) {
      if (ui) ui.setStatus('Opening browser for Audio Streaming permission (Step 2/2)...', true);
      try {
        const result = await clients.auth.beginStreaming();
        if (result.authUrl) {
          const opened = openBrowser(result.authUrl);
          const copied = copyToClipboard(result.authUrl);
          let msg = opened
            ? 'Browser opened for Audio Streaming permission (Step 2/2)!'
            : 'Please complete Audio Streaming login in your browser';
          if (copied) msg += ' (URL copied to clipboard)';
          if (ui) ui.setStatus(msg, true);
        }
      } catch (err) {
        if (ui) ui.setStatus(`Streaming auth error: ${err instanceof Error ? err.message : String(err)}`, true);
      }
      return;
    }

    if (ui) ui.setStatus('Opening browser for Web API permission (Step 1/2)...', true);
    try {
      const result = await clients.auth.begin();
      if (result.authUrl) {
        const opened = openBrowser(result.authUrl);
        const copied = copyToClipboard(result.authUrl);
        let msg = opened
          ? 'Browser opened for Web API permission (Step 1/2)!'
          : 'Please complete login in your browser';
        if (copied) {
          msg += ' (URL copied to clipboard)';
        }
        if (ui) ui.setStatus(msg, true);
      }
    } catch (err) {
      if (ui) ui.setStatus(`Auth error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  };

  const triggerLogout = async (): Promise<void> => {
    const ui = getUi();
    if (ui) ui.setStatus('Logging out and clearing session...', true);
    try {
      await clients.auth.logout();
      if (ui) {
        ui.setRoute('onboarding');
        ui.setStatus('Logged out successfully. Press [A] or [Enter] to login again.', true);
      }
    } catch (err) {
      if (ui) ui.setStatus(`Logout error: ${err instanceof Error ? err.message : String(err)}`, true);
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
