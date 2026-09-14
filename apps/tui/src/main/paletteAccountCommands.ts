import { getStatusBadge } from '../ui/views/nav';
import type { Ui } from '../ui/types';
import { handleOpenFromClipboard } from './clipboardPlayback';
import { switchPlaybackDeviceModal } from './deviceSwitcher';
import type { PaletteActionDeps, PaletteCommand } from './paletteTypes';
import type { AppContext } from './types';

export function buildPaletteSetupCommand(_ctx: AppContext, getUi: () => Ui | null): PaletteCommand {
  return {
    name: 'Configure Spotify Client ID',
    description: 'Set/update Spotify Client ID',
    action: () => {
      const u = getUi();
      if (u) {
        u.focusClientIdInput();
        u.setStatus('Paste Spotify Client ID and press Enter to save', true);
      }
    },
  };
}

export function buildPaletteAccountCommands(
  ctx: AppContext,
  actions: PaletteActionDeps,
  getUi: () => Ui | null,
  quit: () => Promise<void>,
): PaletteCommand[] {
  const { clients, state } = ctx;
  return [
    {
      name: 'Authenticate with Spotify',
      description: 'OAuth (press A on the login page)',
      action: actions.triggerAuth,
    },
    {
      name: 'Open Login Page',
      description: 'Standalone onboarding (login, permissions, Client ID)',
      action: () => getUi()?.setRoute('onboarding'),
    },
    {
      name: 'Log Out of Spotify',
      description: 'Clear keyring tokens, session, and cache (Ctrl+L on the login page)',
      action: actions.triggerLogout,
    },
    {
      name: 'Switch Playback Device...',
      description: 'Transfer playback to another device',
      action: () => {
        void switchPlaybackDeviceModal(ctx, getUi);
      },
    },
    {
      name: 'Open Spotify Link / URI from Clipboard',
      description: 'Play track/album/artist/playlist from clipboard (o / Ctrl-V)',
      action: () => {
        void handleOpenFromClipboard(ctx, actions, getUi);
      },
    },
    {
      name: 'Toggle Private Session',
      description: 'Hide listening activity',
      action: () => {
        const next = !ctx.state.isPrivateSession;
        ctx.state.isPrivateSession = next;
        if (ctx.state.currentInfo) {
          ctx.state.currentInfo.isPrivateSession = next;
        }
        const u = getUi();
        if (u) {
          const badge = getStatusBadge(next);
          u.setStatus(`Private Session ${next ? `enabled ${badge}` : 'disabled'}`);
        }
      },
    },
    {
      name: 'Toggle Device Mode (Integrated/ConnectOnly)',
      description: 'Switch between local audio playback and Spotify Connect receiver',
      action: () => {
        const cur = state.currentInfo.audioConfig?.deviceMode ?? 'integrated';
        const next = cur === 'connect_only' ? 'integrated' : 'connect_only';
        void clients.playback
          .setAudioConfig({ deviceMode: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(
              `Device Mode: ${next === 'connect_only' ? 'Connect Only (Remote)' : 'Integrated (Local)'}`,
            );
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set device mode: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    {
      name: 'Cycle Audio Bitrate',
      description: 'Cycle streaming quality (320k -> 160k -> 96k)',
      action: () => {
        const cur = state.currentInfo.audioConfig?.bitrate ?? '320';
        const next = cur === '320' ? '160' : cur === '160' ? '96' : '320';
        void clients.playback
          .setAudioConfig({ bitrate: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(`Audio Bitrate: ${next} kbps`);
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set bitrate: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    {
      name: 'Toggle Audio Normalisation',
      description: 'Enable or disable volume normalisation',
      action: () => {
        const cur = state.currentInfo.audioConfig?.normalisation !== false;
        const next = !cur;
        void clients.playback
          .setAudioConfig({ normalisation: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(`Audio Normalisation: ${next ? 'Enabled' : 'Disabled'}`);
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set normalisation: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    {
      name: 'Adjust Crossfade Duration',
      description: 'Cycle crossfade duration (Off -> 2s -> 5s -> 8s -> 12s)',
      action: () => {
        const cur = state.currentInfo.audioConfig?.crossfadeDurationMs ?? 0;
        const next =
          cur === 0 ? 2000 : cur <= 2000 ? 5000 : cur <= 5000 ? 8000 : cur <= 8000 ? 12000 : 0;
        void clients.playback
          .setAudioConfig({ crossfadeDurationMs: next })
          .then((cfg) => {
            state.currentInfo.audioConfig = { ...state.currentInfo.audioConfig, ...cfg };
            getUi()?.setAudioConfig(cfg);
            getUi()?.setStatus(`Crossfade Duration: ${next > 0 ? `${next / 1000}s` : 'Off'}`);
          })
          .catch((e) => {
            getUi()?.setStatus(
              `Failed to set crossfade: ${e instanceof Error ? e.message : String(e)}`,
            );
          });
      },
    },
    { name: 'Quit Spotoei', description: 'q / Ctrl-C', action: () => void quit() },
  ];
}
