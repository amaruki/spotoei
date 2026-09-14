import type { AppContext } from './types';
import type { PlayTrackOpts } from './playback';
import type { Ui } from '../ui/types';
import { readFromClipboard } from '../system';

export interface ParsedSpotifyTarget {
  type: 'track' | 'album' | 'artist' | 'playlist' | 'episode' | 'show';
  id: string;
  uri: string;
}

function stripControlChars(s: string): string {
  return Array.from(s)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return (code >= 32 && code !== 127) || code > 159;
    })
    .join('');
}

export function parseSpotifyUriOrUrl(raw: string): ParsedSpotifyTarget | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > 1024) return null;
  const stripped = stripControlChars(raw);
  const trimmed = stripped.trim();
  // 1. Spotify URI format: spotify:track:id or spotify:album:id etc.
  const uriMatch =
    /^spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]+)$/.exec(trimmed) ||
    /spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]+)/.exec(trimmed);
  if (uriMatch?.[1] && uriMatch[2]) {
    const type = uriMatch[1] as ParsedSpotifyTarget['type'];
    const id = uriMatch[2];
    return { type, id, uri: `spotify:${type}:${id}` };
  }

  // 2. Open Spotify Web URL format: https://open.spotify.com/track/id, with optional query params, locale prefix, or user playlist
  const urlMatch =
    /(?:https?:\/\/)?open\.spotify\.com\/(?:[a-zA-Z]{2,4}(?:-[a-zA-Z]{2,4})?\/)?(?:user\/[^/]+\/)?(track|album|artist|playlist|episode|show)\/([A-Za-z0-9]+)/.exec(
      trimmed,
    );
  if (urlMatch?.[1] && urlMatch[2]) {
    const type = urlMatch[1] as ParsedSpotifyTarget['type'];
    const id = urlMatch[2];
    return { type, id, uri: `spotify:${type}:${id}` };
  }

  return null;
}

export async function handleOpenFromClipboard(
  ctx: AppContext,
  actions?: { playTrackOrContext?: (opts: PlayTrackOpts) => Promise<void> },
  getUi?: () => Ui | null,
  rawOverride?: string,
): Promise<boolean> {
  const ui = getUi ? getUi() : ctx.getUi();
  const text = rawOverride ?? (await readFromClipboard());
  if (!text) {
    ui?.setStatus('Clipboard is empty or unavailable', true);
    return false;
  }
  if (text.length > 1024) {
    ui?.setStatus('Clipboard content too large', true);
    return false;
  }

  const sanitized = stripControlChars(text);
  const target = parseSpotifyUriOrUrl(sanitized);
  if (!target) {
    ui?.setStatus('No Spotify link or URI found in clipboard', true);
    return false;
  }

  ui?.setStatus(`Playing ${target.type} from clipboard: ${target.uri}…`);
  try {
    if (actions?.playTrackOrContext) {
      if (target.type === 'track') {
        await actions.playTrackOrContext({
          trackUri: target.uri,
          title: `Track (${target.id})`,
        });
      } else {
        await actions.playTrackOrContext({
          contextUri: target.uri,
          title: `${target.type} (${target.id})`,
        });
      }
    } else {
      if (target.type === 'track') {
        await ctx.clients.playback.load({ trackUri: target.uri });
      } else {
        await ctx.clients.playback.load({ contextUri: target.uri });
      }
      await ctx.clients.playback.play();
    }
    ui?.setStatus(`Playing ${target.type} from clipboard: ${target.uri}`);
    return true;
  } catch (err) {
    ui?.setStatus(`Playback error: ${err instanceof Error ? err.message : String(err)}`, true);
    return false;
  }
}
