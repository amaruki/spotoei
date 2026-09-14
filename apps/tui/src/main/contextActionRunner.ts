import { mutateUrisWithPreservation } from '../entityMutations';
import { pinDrivingPlaylist } from '../entities/actions';
import type { CatalogTrackT } from 'spotoei-protocol';
import type { ContextTarget, Ui } from '../ui/types';
import { handleAddToPlaylist, handleRemoveFromPlaylist } from './contextPlaylistActions';
import type { PlayTrackOpts } from './playback';
import type { AppContext } from './types';

export type { ContextTarget };

export interface ContextDeps {
  playTrackOrContext: (opts: PlayTrackOpts) => Promise<void>;
  updateQueueView: () => Promise<void>;
  ensureAutoplayTracks: () => Promise<void>;
  playRadio?: (opts: { seedUri: string; title?: string }) => Promise<void>;
}

export type ContextActionDeps = AppContext & { contextActions: ContextDeps };

function spotifyUrl(target: ContextTarget): string {
  const kind = target.kind === 'browse-entry' ? 'playlist' : target.kind;
  return `https://open.spotify.com/${kind}/${target.id}`;
}

// Shared runner used by both the x overlay menu and the palette mirror.
// Every branch reports its outcome through ui status; failures never
// replace playback metadata.
export async function runContextAction(
  ctx: ContextActionDeps,
  getUi: () => Ui | null,
  action: string,
  target: ContextTarget,
): Promise<void> {
  const ui = getUi();
  const { clients, state } = ctx;
  const { playTrackOrContext, updateQueueView, ensureAutoplayTracks } = ctx.contextActions;
  const accountId = state.currentInfo.auth.accountId ?? 'default';
  switch (action) {
    case 'play': {
      if (target.kind === 'track' && target.uri) {
        await playTrackOrContext({ trackUri: target.uri, title: target.name });
        await updateQueueView();
        await ensureAutoplayTracks();
      } else if (target.uri) {
        await playTrackOrContext({ contextUri: target.uri, title: target.name });
      } else {
        ui?.setStatus(`Cannot play ${target.name}: missing Spotify URI`, true);
      }
      return;
    }
    case 'song_radio': {
      if (!target.uri) {
        ui?.setStatus(`Cannot start radio for ${target.name}: missing Spotify URI`, true);
        return;
      }
      if (ctx.contextActions.playRadio) {
        await ctx.contextActions.playRadio({ seedUri: target.uri, title: target.name });
      } else {
        await playTrackOrContext({ trackUri: target.uri, title: target.name });
      }
      await updateQueueView();
      await ensureAutoplayTracks();
      return;
    }
    case 'artist_radio': {
      let artistUri = target.artistUri;
      let artistName = target.artistName;
      if (!artistUri && target.kind === 'artist') {
        artistUri = target.uri;
        artistName = target.name;
      }
      if (!artistUri) {
        const pool =
          state.activePlaylistTracks.length > 0 ? state.activePlaylistTracks : state.libraryItems;
        const trackObj = pool.find(
          (
            t: unknown,
          ): t is {
            uri?: string;
            id?: string;
            artists?: Array<{ uri?: string; id?: string; name?: string }>;
          } =>
            typeof t === 'object' &&
            t !== null &&
            ('uri' in t
              ? (t as { uri?: string }).uri === target.uri
              : 'id' in t && (t as { id?: string }).id === target.id),
        );
        const firstArtist = trackObj?.artists?.[0];
        if (firstArtist?.uri) {
          artistUri = firstArtist.uri;
          artistName = firstArtist.name;
        } else if (firstArtist?.id) {
          artistUri = `spotify:artist:${firstArtist.id}`;
          artistName = firstArtist.name;
        }
      }
      const seed = artistUri ?? target.uri;
      if (!seed) {
        ui?.setStatus(`Cannot start artist radio for ${target.name}: missing URI`, true);
        return;
      }
      const radioTitle = artistName ? `${artistName} Radio` : `${target.name} Radio`;
      if (ctx.contextActions.playRadio) {
        await ctx.contextActions.playRadio({ seedUri: seed, title: radioTitle });
      } else {
        await playTrackOrContext({ contextUri: seed, title: radioTitle });
      }
      await updateQueueView();
      await ensureAutoplayTracks();
      return;
    }
    case 'queue': {
      if (!target.uri) {
        ui?.setStatus(`Cannot queue ${target.name}: missing Spotify URI`, true);
        return;
      }
      const isLocal = state.currentInfo.audioConfig?.deviceMode !== 'connect_only';
      if (isLocal) {
        const pool =
          state.activePlaylistTracks.length > 0 ? state.activePlaylistTracks : state.libraryItems;
        const trackObj = pool.find(
          (t: unknown): t is CatalogTrackT =>
            typeof t === 'object' &&
            t !== null &&
            ('uri' in t ? (t as { uri?: string }).uri === target.uri : false),
        );
        const trackToAdd: CatalogTrackT = trackObj ?? {
          id: target.uri.replace('spotify:track:', ''),
          uri: target.uri,
          name: target.name,
          artists: target.artistName
            ? [
                {
                  id: 'unknown',
                  name: target.artistName,
                  uri: target.artistUri ?? 'spotify:artist:unknown',
                },
              ]
            : [],
          albumName: '',
          durationMs: 0,
        };
        state.activePlaylistTracks.push(trackToAdd);
        ui?.setStatus(`Queued ${target.name}`, true);
        await updateQueueView();
        return;
      }
      const ok = await clients.queueManager.add(target.uri);
      ui?.setStatus(ok ? `Queued ${target.name}` : `Failed to queue ${target.name}`, !ok);
      if (ok) await updateQueueView();
      return;
    }
    case 'like':
    case 'unlike': {
      // LibraryManager performs the generic URI mutation and refreshes
      // only the saved-tracks section on success.
      const ok =
        action === 'like'
          ? await clients.libraryManager.save('track', target.id)
          : await clients.libraryManager.remove('track', target.id);
      ui?.setStatus(
        ok
          ? action === 'like'
            ? `Liked ${target.name}`
            : `Unliked ${target.name}`
          : `Failed to ${action} ${target.name}`,
        !ok,
      );
      return;
    }
    case 'add_to_playlist': {
      await handleAddToPlaylist(ctx, ui, target);
      return;
    }
    case 'remove_from_playlist': {
      await handleRemoveFromPlaylist(ctx, ui, target);
      return;
    }
    case 'save':
    case 'remove': {
      const ok =
        target.kind === 'playlist'
          ? action === 'save'
            ? await clients.libraryManager.savePlaylist(target.id)
            : await clients.libraryManager.removePlaylist(target.id)
          : action === 'save'
            ? await clients.libraryManager.save('album', target.id)
            : await clients.libraryManager.remove('album', target.id);
      ui?.setStatus(
        ok
          ? `${action === 'save' ? 'Saved' : 'Removed'} ${target.name}`
          : `Failed to ${action} ${target.name}`,
        !ok,
      );
      return;
    }
    case 'follow':
    case 'unfollow': {
      // Artist follow runs through the documented generic Library
      // mutation; deprecated follow endpoints are never used.
      if (!target.uri) {
        ui?.setStatus(`Cannot ${action} ${target.name}: missing Spotify URI`, true);
        return;
      }
      const res = await mutateUrisWithPreservation(
        clients.webApi,
        clients.cache,
        accountId,
        [target.uri],
        action === 'follow' ? 'save' : 'remove',
      );
      if (res.ok) {
        clients.libraryManager.invalidate('followed_artists');
        ui?.setStatus(`${action === 'follow' ? 'Followed' : 'Unfollowed'} ${target.name}`);
      } else {
        ui?.setStatus(`Failed to ${action} ${target.name}: ${res.error}`, true);
      }
      return;
    }
    case 'open_artist':
    case 'open_album': {
      const match = /spotify:(artist|album):([A-Za-z0-9]+)/.exec(target.uri ?? '');
      if (match?.[1] === 'artist') ui?.setRoute({ kind: 'artist', id: match[2] as string });
      else if (match?.[1] === 'album') ui?.setRoute({ kind: 'album', id: match[2] as string });
      else ui?.setStatus(`No linked ${match?.[1] ?? 'entity'} for ${target.name}`, true);
      return;
    }
    case 'pin_driving': {
      if (!target.uri) {
        ui?.setStatus(`Cannot pin ${target.name}: missing Spotify URI`, true);
        return;
      }
      pinDrivingPlaylist(target.uri);
      ui?.setStatus(`Pinned ${target.name} for driving`);
      return;
    }
    case 'open_spotify': {
      ui?.setStatus(`Open in Spotify: ${spotifyUrl(target)}`, true);
      return;
    }
    case 'copy_uri': {
      ui?.setStatus(`Spotify URI: ${target.uri ?? target.id}`, true);
      return;
    }
    case 'open': {
      if (target.kind === 'browse-entry') {
        ui?.setRoute({ kind: 'browse', path: { category: target.id } });
      } else {
        ui?.setStatus(`Nothing to open for ${target.name}`, true);
      }
      return;
    }
    default: {
      ui?.setStatus(`Unknown action: ${action}`, true);
    }
  }
}
