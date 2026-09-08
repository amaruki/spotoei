import { describe, expect, it } from 'bun:test';
import { PlayerEndpoints, seekRelative, toggleMute, getDevices, transferPlayback } from '../src/webApi/player';
import { Transport } from '../src/webApi/transport';

describe('Player Web API endpoints (seekRelative & toggleMute)', () => {
  it('seeks relative forward and backward with clamping to 0', async () => {
    const requestedUrls: string[] = [];
    const fakeTransport = {
      async request(path: string, _body: unknown = {}, method = 'GET') {
        requestedUrls.push(`${method} ${path}`);
        return null;
      },
    } as unknown as Transport;

    // Forward seek: 10000 + 5000 = 15000
    await seekRelative(fakeTransport, 10000, 5000);
    expect(requestedUrls).toContain('PUT /me/player/seek?position_ms=15000');

    // Backward seek: 10000 - 3000 = 7000
    await seekRelative(fakeTransport, 10000, -3000);
    expect(requestedUrls).toContain('PUT /me/player/seek?position_ms=7000');

    // Backward seek below 0 clamps to 0
    await seekRelative(fakeTransport, 2000, -5000);
    expect(requestedUrls).toContain('PUT /me/player/seek?position_ms=0');

    // Via PlayerEndpoints class
    const endpoints = new PlayerEndpoints(fakeTransport);
    await endpoints.seekRelative(30000, 10000);
    expect(requestedUrls).toContain('PUT /me/player/seek?position_ms=40000');
  });

  it('toggles mute with explicit currentState', async () => {
    const requests: string[] = [];
    const fakeTransport = {
      async request(path: string, _body: unknown = {}, method = 'GET') {
        requests.push(`${method} ${path}`);
        return null;
      },
    } as unknown as Transport;

    // currentState === false (currently unmuted) -> mute (volume 0)
    await toggleMute(fakeTransport, false);
    expect(requests[requests.length - 1]).toBe('PUT /me/player/volume?volume_percent=0');

    // currentState === true (currently muted) -> unmute (volume restored)
    await toggleMute(fakeTransport, true);
    expect(requests[requests.length - 1]).toBe('PUT /me/player/volume?volume_percent=50');
  });

  it('toggles mute automatically by inspecting current playback state when state is omitted', async () => {
    let currentVolume: number = 75;
    const requests: string[] = [];
    const fakeTransport = {
      async request(path: string, _body: unknown = {}, method = 'GET') {
        requests.push(`${method} ${path}`);
        if (method === 'GET' && path === '/me/player') {
          return { device: { volume_percent: currentVolume } };
        }
        if (method === 'PUT' && path.startsWith('/me/player/volume?volume_percent=')) {
          const volStr = path.split('=')[1] ?? '0';
          currentVolume = parseInt(volStr, 10);
          return null;
        }
        return null;
      },
    } as unknown as Transport;

    const endpoints = new PlayerEndpoints(fakeTransport);

    // Initial state: volume 75 -> toggleMute should set volume to 0
    await endpoints.toggleMute();
    expect(currentVolume).toBe(0);
    expect(requests).toContain('PUT /me/player/volume?volume_percent=0');

    // Second call: volume 0 -> toggleMute should restore previous volume (75)
    await endpoints.toggleMute();
    expect(currentVolume).toBe(75);
    expect(requests).toContain('PUT /me/player/volume?volume_percent=75');
  });

  it('fetches devices and transfers playback', async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const fakeTransport = {
      async request(path: string, body: unknown = {}, method = 'GET') {
        requests.push({ method, path, body });
        if (path === '/me/player/devices') {
          return {
            devices: [
              { id: 'd1', name: 'Desktop Speakers', is_active: true, type: 'Computer' },
              { id: 'd2', name: 'Living Room Echo', is_active: false, type: 'Speaker' },
            ],
          };
        }
        return null;
      },
    } as unknown as Transport;

    // Standalone getDevices
    const devices = await getDevices(fakeTransport);
    expect(devices.length).toBe(2);
    expect(devices[0]?.name).toBe('Desktop Speakers');
    expect(devices[1]?.id).toBe('d2');

    // Standalone transferPlayback
    await transferPlayback(fakeTransport, 'd2', true);
    expect(requests[requests.length - 1]).toEqual({
      method: 'PUT',
      path: '/me/player',
      body: { device_ids: ['d2'], play: true },
    });

    // Via PlayerEndpoints class
    const endpoints = new PlayerEndpoints(fakeTransport);
    const devicesViaClass = await endpoints.getDevices();
    expect(devicesViaClass.length).toBe(2);
    await endpoints.transferPlayback('d1', false);
    expect(requests[requests.length - 1]).toEqual({
      method: 'PUT',
      path: '/me/player',
      body: { device_ids: ['d1'], play: false },
    });
  });

  it('caches devices for 30 seconds', async () => {
    let callCount = 0;
    const fakeTransport = {
      async request(path: string) {
        if (path === '/me/player/devices') {
          callCount++;
          return {
            devices: [{ id: 'd1', name: 'Cached Speaker', is_active: true, type: 'Speaker' }],
          };
        }
        return null;
      },
    } as unknown as Transport;

    const dev1 = await getDevices(fakeTransport, true);
    const dev2 = await getDevices(fakeTransport);
    expect(dev1.length).toBe(1);
    expect(dev2.length).toBe(1);
    expect(callCount).toBe(1);
  });
});
