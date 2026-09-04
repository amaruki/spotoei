// Spotify Connect playback endpoints and device management.

import type { Transport } from './transport';

export class PlayerEndpoints {
  constructor(private transport: Transport) {}

  async play(opts: {
    uris?: string[];
    context_uri?: string;
    position_ms?: number;
    device_id?: string;
  }): Promise<void> {
    const query = opts.device_id ? `?device_id=${encodeURIComponent(opts.device_id)}` : '';
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

  async setVolume(volumePercent: number): Promise<void> {
    const vol = Math.min(100, Math.max(0, Math.round(volumePercent)));
    await this.transport.request(`/me/player/volume?volume_percent=${vol}`, {}, 'PUT');
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

  async getDevices(): Promise<
    Array<{ id: string; name: string; is_active: boolean; type: string }>
  > {
    try {
      const json = await this.transport.request('/me/player/devices');
      if (
        json &&
        typeof json === 'object' &&
        'devices' in json &&
        Array.isArray((json as Record<string, unknown>).devices)
      ) {
        return (
          json as {
            devices: Array<{ id: string; name: string; is_active: boolean; type: string }>;
          }
        ).devices;
      }
    } catch {
      // ignore
    }
    return [];
  }

  async transferPlayback(deviceId: string, play = true): Promise<void> {
    await this.transport.request('/me/player', { device_ids: [deviceId], play }, 'PUT');
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
