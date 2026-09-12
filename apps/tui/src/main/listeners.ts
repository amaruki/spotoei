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
  let streamingCheckVersion = 0;
  let streamingFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStreamingFallback = (): void => {
    if (streamingFallbackTimer) clearTimeout(streamingFallbackTimer);
    streamingFallbackTimer = null;
  };

  const markStreamingPending = (): void => {
    state.hasStreaming = false;
    const ui = getUi();
    if (ui) ui.setStreamingPending(true);
    else state.currentInfo.streamingPending = true;
  };

  const markStreamingReady = (showWelcome: boolean): void => {
    streamingCheckVersion++;
    clearStreamingFallback();
    state.hasStreaming = true;
    const ui = getUi();
    if (ui) {
      ui.setStreamingPending(false);
      if (showWelcome) {
        ui.setStatus(
          '🎉 Setup complete! Web API and Audio Streaming connected. Welcome to Spotoei.',
          true,
        );
      }
      if (routeKind(ui.getRoute()) === 'onboarding') ui.setRoute('home');
    } else {
      state.currentInfo.streamingPending = false;
    }
  };

  const clearStreamingPending = (): void => {
    const ui = getUi();
    if (ui) ui.setStreamingPending(false);
    else state.currentInfo.streamingPending = false;
  };

  const reconcileStreaming = async (startWhenMissing: boolean): Promise<void> => {
    const version = ++streamingCheckVersion;
    const hasStreaming =
      typeof clients.auth?.streamingStatus === 'function'
        ? await clients.auth.streamingStatus().catch(() => false)
        : false;
    if (version !== streamingCheckVersion) return;
    if (state.currentInfo.auth?.state !== 'authenticated') return;
    if (hasStreaming) {
      markStreamingReady(false);
      return;
    }
    markStreamingPending();
    if (startWhenMissing) await actions.triggerAuth({ streamingOnly: true });
  };

  const scheduleStreamingFallback = (): void => {
    clearStreamingFallback();
    streamingFallbackTimer = setTimeout(() => {
      streamingFallbackTimer = null;
      void reconcileStreaming(true);
    }, 250);
  };

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
    streamingCheckVersion++;
    clearStreamingFallback();
    state.hasStreaming = false;
    const webSessionSurvived = state.currentInfo.auth?.state === 'authenticated';
    if (ui) {
      ui.setStreamingPending(webSessionSurvived);
      ui.setStatus(`Login failed (${failure.reason}): ${failure.message}`, true);
    } else state.currentInfo.streamingPending = webSessionSurvived;
  });

  clients.auth.onAuthCompleted?.((completed: AuthCompletedEventDataT) => {
    if (completed.streaming) {
      markStreamingReady(true);
    } else {
      // The terminal Web-completion event is the safe handoff point. Starting
      // streaming from the earlier auth.changed event can tear down the Web
      // callback task while it is still finalizing the first transaction.
      clearStreamingFallback();
      void reconcileStreaming(true);
    }
  });

  clients.auth.onStatusChange((next: AuthStatusDataT) => {
    const wasAuthed = state.currentInfo.auth?.state === 'authenticated';
    const previousAccountId = state.currentInfo.auth?.accountId;
    const changedAccount =
      next.state === 'authenticated' &&
      (previousAccountId ?? 'anonymous') !== (next.accountId ?? 'anonymous');
    const ui = getUi();
    if (changedAccount) {
      const accountId = next.accountId ?? 'anonymous';
      ctx.setActiveAccountId?.(accountId);
      clients.searchClient?.setAccountId(accountId);
      clients.libraryManager?.setAccountId(accountId);
      clients.entityManager?.setAccountId(accountId);
      clients.homeManager?.setAccountId(accountId);
      state.libraryItems = [];
      state.entityPages = {};
      state.activePlaylistTracks = [];
      state.currentSearchHits = [];
      state.artistGenreCache?.clear();
      state.homeTabs = { activeTab: 'for_you', range: 'medium_term' };
      state.currentInfo.playback = null;
      if (ui) ui.setPlayback(null);
    }
    if (next.state === 'unauthenticated') {
      if (wasAuthed) {
        void clients.playback.pause().catch(() => {});
        state.hasStreaming = false;
        state.currentInfo.playback = null;
        if (ui) {
          ui.setPlayback(null);
        }
      }
      // A pending streaming login died with the session: without this, the
      // next press re-opens a dead authorization URL instead of starting fresh.
      clearStreamingPending();
    } else if (next.state === 'refresh-failed') {
      if (ui) ui.setStatus('Session refresh failed; will retry', true);
    }
    if (!wasAuthed && next.state === 'authenticated') {
      markStreamingPending();
    }
    // ui.setAuth owns the state mutation (same object by reference) so its
    // transition check sees the real before/after; pre-mutating here would
    // make every transition look like a no-op and skip routing home.
    if (ui) ui.setAuth(next);
    else state.currentInfo.auth = next;
    if (next.state === 'authenticated') {
      if (wasAuthed && state.currentInfo.streamingPending) {
        // A streaming auth.changed snapshot is authoritative recovery when
        // auth.completed was delayed or lost.
        void reconcileStreaming(false);
      } else if (!wasAuthed) {
        // auth.completed normally starts Step 2. This delayed fallback also
        // covers a dropped terminal event without racing the callback task.
        scheduleStreamingFallback();
      }
    }
  });

  clients.playback.onChange((next: PlaybackChangedDataT) => {
    const wasPlaying = state.lastPlaybackState === 'playing';
    const previousState = state.lastPlaybackState;
    state.lastPlaybackState = next.state;

    const view = enrichment.enrichPlaybackTrack(next);
    state.currentInfo.playback = view;
    const ui = getUi();
    if (ui) ui.setPlayback(view);
    // Confirm the load only once librespot actually starts the stream.
    const justStarted =
      next.state === 'playing' && (previousState === 'loading' || previousState === 'buffering');
    if (ui && justStarted && view.track?.name) ui.setStatus(`▶ Playing: ${view.track.name}`);
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
