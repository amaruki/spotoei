import type {
  AuthCompletedEventDataT,
  AuthFailedEventDataT,
  AuthStatusDataT,
  CatalogTrackT,
  PlaybackChangedDataT,
  PlaybackPositionDataT,
} from 'spotoei-protocol';
import { routeKind } from '../ui/core/navigationStack';
import { resolveQueueView } from '../queue';
import type { PlayTrackOpts } from './playback';
import type { createEnrichment } from './enrich';
import type { AppContext, AppState } from './types';
export function wireSubscriptions(
  ctx: AppContext,
  actions: {
    triggerAuth: (opts?: { streamingOnly?: boolean }) => Promise<void>;
    loadLibrary: (
      force?: boolean,
      collection?: import('spotoei-protocol').LibraryCollectionT,
    ) => Promise<void>;
    loadCurrentLyrics: (force?: boolean) => Promise<void>;
    updateQueueView: () => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    playTrackOrContext: (opts: PlayTrackOpts) => Promise<void>;
    nextTrack: () => Promise<void>;
  },
  enrichment: ReturnType<typeof createEnrichment>,
): void {
  const { clients, state, getUi } = ctx;

  clients.visualizer.subscribe((mode, data) => {
    const ui = getUi();
    if (ui) {
      ui.setVisualizerFrame({ mode, data });
    }
  });

  // A backend login failure used to die silently (only the token cache was
  // cleared). Surface it so a stuck "Waiting…" always ends with a reason.
  clients.auth.onAuthFailure?.((failure: AuthFailedEventDataT) => {
    const ui = getUi();
    state.currentInfo.streamingPending = false;
    if (ui) {
      ui.setStreamingPending(false);
      ui.setStatus(`Login failed (${failure.reason}): ${failure.message}`, true);
    }
  });

  clients.auth.onAuthCompleted?.((completed: AuthCompletedEventDataT) => {
    if (!completed.streaming) return;
    const ui = getUi();
    state.currentInfo.streamingPending = false;
    if (ui) {
      ui.setStreamingPending(false);
      ui.setStatus('Audio streaming connected — press play', true);
    }
  });

  clients.auth.onStatusChange((next: AuthStatusDataT) => {
    const wasAuthed = state.currentInfo.auth?.state === 'authenticated';
    const ui = getUi();
    // ui.setAuth owns the state mutation (same object by reference) so its
    // transition check sees the real before/after; pre-mutating here would
    // make every transition look like a no-op and skip routing home.
    if (ui) ui.setAuth(next);
    else state.currentInfo.auth = next;
    if (!wasAuthed && next.state === 'authenticated') {
      state.currentInfo.streamingPending = true;
      if (ui) ui.setStreamingPending(true);
      // Top up the streaming login through the single trigger: it re-opens
      // a pending flow instead of minting a second one that would orphan the
      // first tab into a state mismatch.
      void actions.triggerAuth({ streamingOnly: true });
      void (async () => {
        try {
          const devices = await clients.webApi?.getDevices?.();
          const spotoei = devices?.find((d) => d.name.toLowerCase().includes('spotoei'));
          if (spotoei && !spotoei.is_active) {
            void clients.webApi?.transferPlayback?.(spotoei.id, false).catch(() => {});
          }
        } catch {
          // ignore device probe
        }
      })();
    }
  });

  clients.playback.onChange((next: PlaybackChangedDataT) => {
    const wasPlaying = state.lastPlaybackState === 'playing';
    state.lastPlaybackState = next.state;

    const view = enrichment.enrichPlaybackTrack(next);
    state.currentInfo.playback = view;
    const ui = getUi();
    if (ui) ui.setPlayback(view);
    void actions.updateQueueView();
    void actions.ensureAutoplayTracks();
    if (ui && routeKind(ui.getRoute()) === 'lyrics') {
      void actions.loadCurrentLyrics();
    }

    if (wasPlaying && view.state === 'idle') {
      void advanceAutoplay(ctx, actions);
    }
  });

  clients.playback.onPosition((pos: PlaybackPositionDataT) => {
    const cur = state.currentInfo.playback;
    if (!cur) return;
    if (cur.state === 'playing' || cur.state === 'loading' || pos.revision === cur.revision) {
      const ui = getUi();
      if (ui) ui.setPlaybackPosition(pos);
    }
  });

  clients.queueManager.subscribe((snap) => {
    // Same merged view as updateQueueView so subscription repaints
    // (e.g. after add()) never flash the cloud-only snapshot.
    const view = resolveQueueView(
      snap,
      state.activePlaylistTracks,
      state.currentInfo.playback?.track ?? null,
    );
    state.currentInfo.queue = view;
    const ui = getUi();
    if (ui) ui.setQueueSnapshot(view);
  });

  clients.lyrics.subscribe((doc) => {
    const ui = getUi();
    if (ui) ui.setLyrics(doc);
  });
}

export function endLooksGenuine(
  pb: { track?: { uri?: string } | null; positionMs: number },
  state: Pick<AppState, 'activePlaylistTracks' | 'libraryItems'>,
): boolean {
  const pos = pb.positionMs;
  // Half a minute of playback is unambiguous regardless of metadata.
  if (pos >= 30_000) return true;
  const uri = pb.track?.uri;
  const known =
    (uri ? state.activePlaylistTracks.find((t) => t.uri === uri)?.durationMs : undefined) ??
    (uri
      ? state.libraryItems.find(
          (it): it is CatalogTrackT => 'durationMs' in it && (it as CatalogTrackT).uri === uri,
        )?.durationMs
      : undefined);
  // At the known end (2s tick tolerance) the track really finished.
  if (known && known > 0) return pos >= known - 2000;
  // Unknown duration: require at least a few seconds so a stale
  // position-0 idle can never trigger an advance.
  return pos >= 5000;
}

async function advanceAutoplay(
  ctx: AppContext,
  actions: {
    playTrackOrContext: (opts: PlayTrackOpts) => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    nextTrack: () => Promise<void>;
  },
): Promise<void> {
  if (ctx.state.isAdvancingAutoplay) return;
  // Defense against stale/spurious idle events (e.g. a pre-load snapshot
  // emitted with position ~0): only advance a track that actually played
  // through. Without this, one bogus idle re-triggers `load`, whose own
  // stale idle re-triggers advance — an infinite skip loop.
  const pb = ctx.state.currentInfo.playback;
  if (!pb || !endLooksGenuine(pb, ctx.state)) return;
  ctx.state.isAdvancingAutoplay = true;
  try {
    if (ctx.state.currentInfo.playback?.repeat === 'track') {
      const curT = ctx.state.currentInfo.playback?.track;
      if (curT?.uri) {
        await actions.playTrackOrContext({
          trackUri: curT.uri,
          title: curT.name,
          meta: { durationMs: curT.durationMs, artists: curT.artists, album: curT.album },
        });
      }
    } else if (ctx.state.currentInfo.playback?.autoplay) {
      await actions.ensureAutoplayTracks();
      await actions.nextTrack();
    }
  } finally {
    setTimeout(() => {
      ctx.state.isAdvancingAutoplay = false;
    }, 1500);
  }
}
