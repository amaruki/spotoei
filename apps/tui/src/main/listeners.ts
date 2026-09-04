import type {
  AuthStatusDataT,
  PlaybackChangedDataT,
  PlaybackPositionDataT,
} from 'spotoei-protocol';
import { routeKind } from '../ui/core/navigationStack';
import type { createEnrichment } from './enrich';
import type { AppContext } from './types';
export function wireSubscriptions(
  ctx: AppContext,
  actions: {
    loadLibrary: (
      force?: boolean,
      collection?: import('spotoei-protocol').LibraryCollectionT,
    ) => Promise<void>;
    loadCurrentLyrics: (force?: boolean) => Promise<void>;
    updateQueueView: () => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    playTrackOrContext: (opts: {
      trackUri?: string;
      contextUri?: string;
      title: string;
    }) => Promise<void>;
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

  clients.auth.onStatusChange((next: AuthStatusDataT) => {
    const wasAuthed = state.currentInfo.auth?.state === 'authenticated';
    const ui = getUi();
    // ui.setAuth owns the state mutation (same object by reference) so its
    // transition check sees the real before/after; pre-mutating here would
    // make every transition look like a no-op and skip routing home.
    if (ui) ui.setAuth(next);
    else state.currentInfo.auth = next;
    if (!wasAuthed && next.state === 'authenticated') {
      ui?.setStatus('Successfully authenticated! Loading library…');
      void actions.loadLibrary();
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
    if (!state.currentInfo.playback) return;
    if (pos.revision !== state.currentInfo.playback.revision) return;
    const ui = getUi();
    if (ui) ui.setPlaybackPosition(pos);
  });

  clients.queueManager.subscribe((snap) => {
    state.currentInfo.queue = snap;
    const ui = getUi();
    if (ui) ui.setQueueSnapshot(snap);
  });

  clients.lyrics.subscribe((doc) => {
    const ui = getUi();
    if (ui) ui.setLyrics(doc);
  });
}

async function advanceAutoplay(
  ctx: AppContext,
  actions: {
    playTrackOrContext: (opts: {
      trackUri?: string;
      contextUri?: string;
      title: string;
    }) => Promise<void>;
    ensureAutoplayTracks: () => Promise<void>;
    nextTrack: () => Promise<void>;
  },
): Promise<void> {
  if (ctx.state.isAdvancingAutoplay) return;
  ctx.state.isAdvancingAutoplay = true;
  try {
    if (ctx.state.currentInfo.playback?.repeat === 'track') {
      const curT = ctx.state.currentInfo.playback?.track;
      if (curT?.uri) {
        await actions.playTrackOrContext({
          trackUri: curT.uri,
          title: curT.name,
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
