// Spotify Connect playback endpoints and device management.

import type { Transport } from './transport';

let lastNonZeroVolume = 50;

/**
 * Toggles playback mute state via the Spotify Web API.
 * If currentState is provided (true = muted, false = unmuted), it toggles to the opposite state.
 * If currentState is omitted, it queries the player state to check if volume is currently 0.
 */
export async function toggleMute(
  transport: Transport,
  currentState?: boolean,
): Promise<void> {
  let isMuted = currentState;
  if (isMuted === undefined) {
    try {
      const state = (await transport.request('/me/player')) as {
        device?: { volume_percent?: number | null };
      } | null;
      const vol = state?.device?.volume_percent;
      if (typeof vol === 'number') {
        if (vol > 0) {
          lastNonZeroVolume = vol;
        }
        isMuted = vol === 0;
      } else {
        isMuted = false;
      }
    } catch {
      isMuted = false;
    }
  }

  if (isMuted) {
    const restoreVol = Math.min(100, Math.max(1, lastNonZeroVolume || 50));
    await transport.request(`/me/player/volume?volume_percent=${restoreVol}`, {}, 'PUT');
  } else {
    await transport.request('/me/player/volume?volume_percent=0', {}, 'PUT');
  }
}

/**
 * Relative seek forward/backward by offsetMs from currentPositionMs.
 * Clamps target position to >= 0.
 */
export async function seekRelative(
  transport: Transport,
  currentPositionMs: number,
  offsetMs: number,
): Promise<void> {
  const target = Math.max(0, Math.floor(currentPositionMs + offsetMs));
  await transport.request(`/me/player/seek?position_ms=${target}`, {}, 'PUT');
}

export interface DeviceInfo {
  id: string;
  name: string;
  is_active: boolean;
  type: string;
}
let cachedDevices: { data: DeviceInfo[]; expiresAt: number } | null = null;
export const DEVICES_CACHE_TTL_MS = 30_000;

export function clearDevicesCache(): void {
  cachedDevices = null;
}

export async function getDevices(transport: Transport, bypassCache = false): Promise<DeviceInfo[]> {
  const now = Date.now();
  if (!bypassCache && cachedDevices && now < cachedDevices.expiresAt) {
    return cachedDevices.data;
  }
  try {
    const json = await transport.request('/me/player/devices');
    if (
      json &&
      typeof json === 'object' &&
      'devices' in json &&
      Array.isArray((json as Record<string, unknown>).devices)
    ) {
      const devices = (
        json as {
          devices: DeviceInfo[];
        }
      ).devices;
      cachedDevices = { data: devices, expiresAt: now + DEVICES_CACHE_TTL_MS };
      return devices;
    }
  } catch {
    // ignore
  }
  return cachedDevices?.data ?? [];
}

export async function transferPlayback(
  transport: Transport,
  deviceId: string,
  play = true,
): Promise<void> {
  clearDevicesCache();
  await transport.request('/me/player', { device_ids: [deviceId], play }, 'PUT');
}

export class PlayerEndpoints {
  constructor(private transport: Transport) {}

  async play(opts: {
    uris?: string[];
    context_uri?: string;
    position_ms?: number;
    device_id?: string;
  }): Promise<void> {
    let deviceId = opts.device_id;
    if (!deviceId) {
      try {
        const devices = await getDevices(this.transport);
        if (devices && devices.length > 0) {
          const active = devices.find((d) => d.is_active);
          const spotoei = devices.find((d) => d.name.toLowerCase().includes('spotoei'));
          deviceId = active?.id ?? spotoei?.id ?? devices[0]?.id;
        }
      } catch {
        // ignore device probe failure
      }
    }
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    const body: Record<string, unknown> = {};
    if (opts.uris) body.uris = opts.uris;
    if (opts.context_uri) body.context_uri = opts.context_uri;
    if (typeof opts.position_ms === 'number') body.position_ms = opts.position_ms;
    await this.transport.request(`/me/player/play${query}`, body, 'PUT');
  }

  async pause(): Promise<void> {
    await this.transport.request('/me/player/pause', {}, 'PUT');
  }

  async nextTrack(): Promise<void> {
    await this.transport.request('/me/player/next', {}, 'POST');
  }

  async previousTrack(): Promise<void> {
    await this.transport.request('/me/player/previous', {}, 'POST');
  }

  async seek(positionMs: number): Promise<void> {
    await this.transport.request(
      `/me/player/seek?position_ms=${Math.max(0, Math.floor(positionMs))}`,
      {},
      'PUT',
    );
  }

  async seekRelative(currentPositionMs: number, offsetMs: number): Promise<void> {
    await seekRelative(this.transport, currentPositionMs, offsetMs);
  }

  async setVolume(volumePercent: number): Promise<void> {
    const vol = Math.min(100, Math.max(0, Math.round(volumePercent)));
    await this.transport.request(`/me/player/volume?volume_percent=${vol}`, {}, 'PUT');
  }

  async toggleMute(currentState?: boolean): Promise<void> {
    await toggleMute(this.transport, currentState);
  }

  async shuffle(state: boolean): Promise<void> {
    await this.transport.request(`/me/player/shuffle?state=${Boolean(state)}`, {}, 'PUT');
  }

  async repeat(state: 'off' | 'track' | 'context'): Promise<void> {
    await this.transport.request(`/me/player/repeat?state=${state}`, {}, 'PUT');
  }

  async getPlaybackState(): Promise<Record<string, unknown> | null> {
    try {
      const json = await this.transport.request('/me/player');
      return json as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  async getDevices(bypassCache = false): Promise<DeviceInfo[]> {
    return getDevices(this.transport, bypassCache);
  }

  async transferPlayback(deviceId: string, play = true): Promise<void> {
    return transferPlayback(this.transport, deviceId, play);
  }

  async getArtistGenres(artistId: string): Promise<string[]> {
    if (!artistId || artistId === 'unknown') return [];
    try {
      const json = await this.transport.request(`/artists/${artistId}`);
      if (
        json &&
        typeof json === 'object' &&
        'genres' in json &&
        Array.isArray((json as Record<string, unknown>).genres)
      ) {
        return (json as { genres: string[] }).genres;
      }
    } catch {
      // ignore
    }
    return [];
  }
}
