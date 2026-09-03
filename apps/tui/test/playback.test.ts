import { describe, expect, test } from 'bun:test';
import { locatePlayer, startPlayer, stopPlayer } from '../src/player';
import { createPlaybackClient } from '../src/playback';
import type { PlaybackChangedDataT, PlaybackPositionDataT } from 'spotoei-protocol';

// Integration tests against a real spawned player child. A short real
// delay is required between command responses and emitted events so the
// event loop drains. Where the test can await a specific event, it does.

const SHORT_WAIT_MS = 50;

function waitMs(ms: number): Promise<void> {
  // Real-time wait necessary: events from the spawned child process arrive
  // on the next event-loop tick, not on a deterministic clock.
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function noop() {}

async function waitForChangedEvent(
  onChange: (snap: PlaybackChangedDataT) => void,
  predicate: (snap: PlaybackChangedDataT) => boolean,
  timeoutMs: number = 1_000,
): Promise<PlaybackChangedDataT> {
  const { promise, resolve, reject } = Promise.withResolvers<PlaybackChangedDataT>();
  const timer = setTimeout(() => {
    onChange(noop);
    reject(new Error(`timed out after ${timeoutMs}ms waiting for change event`));
  }, timeoutMs);
  onChange((snap) => {
    if (predicate(snap)) {
      clearTimeout(timer);
      resolve(snap);
    }
  });
  return promise;
}

describe('playback integration with player sidecar', () => {
  test('fresh player reports idle state with no track loaded', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const playback = createPlaybackClient({ child: handshake.child });

    try {
      const status = await playback.status();
      expect(status.state).toBe('idle');
      expect(status.track).toBeUndefined();
      expect(status.positionMs).toBe(0);
      expect(status.volume).toBeCloseTo(0.8, 1);
    } finally {
      playback.close();
      await stopPlayer(handshake.child);
    }
  });

  test('load track with autoplay starts playback and emits changed event', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const playback = createPlaybackClient({ child: handshake.child });

    const eventPromise = waitForChangedEvent(
      (l) => playback.onChange(l),
      (s) => s.state === 'playing',
    );

    try {
      const snap = await playback.load({
        trackUri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
        autoplay: true,
      });

      expect(snap.state).toBe('playing');
      expect(snap.track?.name).toBe('Track 4cOdK2wGLETKBW3PvgPWqT');
      expect(snap.track?.durationMs).toBe(240000);

      const event = await eventPromise;
      expect(event.state).toBe('playing');
    } finally {
      playback.close();
      await stopPlayer(handshake.child);
    }
  });

  test('pause, play, and toggle state machine transitions', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const playback = createPlaybackClient({ child: handshake.child });

    try {
      await playback.load({
        trackUri: 'spotify:track:demo123',
        autoplay: true,
      });

      const paused = await playback.pause();
      expect(paused.state).toBe('paused');

      const resumed = await playback.play();
      expect(resumed.state).toBe('playing');

      const toggled1 = await playback.toggle();
      expect(toggled1.state).toBe('paused');

      const toggled2 = await playback.toggle();
      expect(toggled2.state).toBe('playing');
    } finally {
      playback.close();
      await stopPlayer(handshake.child);
    }
  });

  test('next, previous, and seek adjust track and position', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const playback = createPlaybackClient({ child: handshake.child });

    try {
      await playback.load({
        trackUri: 'spotify:track:ctx-spotify:album:nav-1',
        contextUri: 'spotify:album:nav',
        autoplay: false,
      });

      const seekSnap = await playback.seek(45000);
      expect(seekSnap.positionMs).toBe(45000);

      const nextSnap = await playback.next();
      expect(nextSnap.track?.uri).toBe('spotify:track:ctx-spotify:album:nav-2');
      expect(nextSnap.positionMs).toBe(0);

      const prevSnap = await playback.previous();
      expect(prevSnap.track?.uri).toBe('spotify:track:ctx-spotify:album:nav-1');
      expect(prevSnap.positionMs).toBe(0);
    } finally {
      playback.close();
      await stopPlayer(handshake.child);
    }
  });

  test('volume, shuffle, repeat, and autoplay settings update cleanly', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const playback = createPlaybackClient({ child: handshake.child });

    try {
      const volSnap = await playback.setVolume(0.42);
      expect(volSnap.volume).toBeCloseTo(0.42, 2);

      await expect(playback.setVolume(1.5)).rejects.toThrow('INVALID_REQUEST');

      const shuffleSnap = await playback.setShuffle(true);
      expect(shuffleSnap.shuffle).toBe(true);

      const repeatSnap = await playback.setRepeat('track');
      expect(repeatSnap.repeat).toBe('track');

      const autoplaySnap = await playback.setAutoplay(false);
      expect(autoplaySnap.autoplay).toBe(false);
    } finally {
      playback.close();
      await stopPlayer(handshake.child);
    }
  });

  test('periodic position events are emitted while playing', async () => {
    const bin = locatePlayer();
    const handshake = await startPlayer(bin);
    const playback = createPlaybackClient({ child: handshake.child });

    const positionEvents: PlaybackPositionDataT[] = [];
    const unsubscribe = playback.onPosition((pos) => {
      positionEvents.push(pos);
    });

    try {
      await playback.load({
        trackUri: 'spotify:track:tickTest',
        autoplay: true,
      });

      // Wait until at least 2 position events are observed (or short
      // window elapses). Position events arrive at ~5 Hz from the
      // player's ticker task; this gives the event loop a chance to
      // drain stdout into our readline.
      const start = Date.now();
      while (positionEvents.length < 2 && Date.now() - start < 1500) {
        // eslint-disable-next-line no-await-in-loop
        await waitMs(SHORT_WAIT_MS);
      }
      expect(positionEvents[0].positionMs).toBeGreaterThan(0);
    } finally {
      unsubscribe();
      playback.close();
      await stopPlayer(handshake.child);
    }
  });
});
