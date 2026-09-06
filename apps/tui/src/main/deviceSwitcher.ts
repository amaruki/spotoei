import type { AppContext } from './types';
import type { ContextMenuItem, Ui } from '../ui/types';
import { getDevices, transferPlayback } from '../webApi/player';

export async function switchPlaybackDeviceModal(
  ctx: AppContext,
  getUi: () => Ui | null,
): Promise<void> {
  const ui = getUi();
  if (!ui) return;
  ui.setStatus('Fetching playback devices…');
  try {
    const transport =
      typeof ctx.clients.webApi?.getTransport === 'function'
        ? ctx.clients.webApi.getTransport()
        : undefined;
    const devices = transport
      ? await getDevices(transport)
      : await ctx.clients.webApi.getDevices();
    if (!devices || devices.length === 0) {
      ui.setStatus('No active Spotify Connect devices found', true);
      return;
    }

    const items: ContextMenuItem[] = devices.map((device) => {
      const activeMarker = device.is_active ? ' (Active)' : '';
      const label = `${device.name}${activeMarker}`;
      const hint = `${device.type}${device.is_active ? ' • Current' : ''}`;
      return {
        label,
        hint,
        run: async () => {
          ui.setStatus(`Transferring playback to ${device.name}…`);
          try {
            if (transport) {
              await transferPlayback(transport, device.id, true);
            } else {
              await ctx.clients.webApi.transferPlayback(device.id, true);
            }
            ui.setStatus(`Playback transferred to ${device.name}`);
          } catch (err) {
            ui.setStatus(
              `Failed to transfer playback: ${err instanceof Error ? err.message : String(err)}`,
              true,
            );
          }
        },
      };
    });

    ui.openContextMenu('Switch Playback Device', items);
  } catch (err) {
    ui.setStatus(
      `Failed to load devices: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
}
