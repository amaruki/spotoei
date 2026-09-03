// Library membership helpers and mutation logic for entities.

import type { LibraryItemKindT, LibraryMembershipT, SaveStateT } from 'spotoei-protocol';
import type { Cache } from './cache';
import type { WebApiClient } from './webApi';

export const MEMBERSHIP_BATCH_SIZE = 40;
export const MAX_URIS = 10000;

export function inferKind(uri: string): LibraryItemKindT {
  if (uri.startsWith('spotify:track:')) return 'track';
  if (uri.startsWith('spotify:album:')) return 'album';
  if (uri.startsWith('spotify:artist:')) return 'artist';
  if (uri.startsWith('spotify:playlist:')) return 'playlist';
  return 'track';
}

export function membershipFor(memberships: LibraryMembershipT[], uri: string): SaveStateT {
  const m = memberships.find((x) => x.uri === uri);
  if (!m) return 'unknown';
  return m.state;
}

export async function checkMembershipBatched(
  client: WebApiClient,
  cache: Cache | undefined,
  accountId: string,
  uris: string[],
  forceRefresh = false,
): Promise<LibraryMembershipT[]> {
  if (uris.length === 0) return [];
  const results: LibraryMembershipT[] = [];
  const uncachedUris: string[] = [];

  for (const uri of uris) {
    if (!forceRefresh && cache) {
      try {
        const cached = cache.getQuery<LibraryMembershipT>(accountId, `membership:v1:${uri}`);
        if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
          results.push(cached.payload);
          continue;
        }
      } catch {
        // Fall back to live
      }
    }
    uncachedUris.push(uri);
  }

  if (uncachedUris.length === 0) return results;

  const batches: string[][] = [];
  for (let i = 0; i < uncachedUris.length; i += MEMBERSHIP_BATCH_SIZE) {
    batches.push(uncachedUris.slice(i, i + MEMBERSHIP_BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const booleans = await client.checkMembership(batch);
      const out: LibraryMembershipT[] = [];
      for (let j = 0; j < batch.length; j++) {
        const uri = batch[j];
        if (!uri) continue;
        const isSaved = booleans[j] ?? false;
        out.push({
          uri,
          kind: inferKind(uri),
          state: isSaved ? 'saved' : 'not_saved',
          updatedAt: Date.now(),
        });
      }
      return out;
    }),
  );

  for (const batch of batchResults) {
    for (const membership of batch) {
      results.push(membership);
      if (cache) {
        try {
          cache.putQuery(accountId, `membership:v1:${membership.uri}`, membership, 60_000);
        } catch {
          // Non-fatal
        }
      }
    }
  }

  return results;
}

export async function mutateUrisWithPreservation(
  client: WebApiClient,
  cache: Cache | undefined,
  accountId: string,
  uris: string[],
  action: 'save' | 'remove',
): Promise<{ ok: boolean; error?: string }> {
  if (uris.length === 0) return { ok: true };
  if (uris.length > MAX_URIS) {
    return { ok: false, error: `Cannot ${action} ${uris.length} URIs (max ${MAX_URIS})` };
  }

  const prior = await checkMembershipBatched(client, cache, accountId, uris, false);
  const priorState = new Map<string, SaveStateT>();
  for (const m of prior) {
    priorState.set(m.uri, m.state);
  }

  const targetState: SaveStateT = action === 'save' ? 'saved' : 'not_saved';

  try {
    if (action === 'save') {
      await client.saveUris(uris);
    } else {
      await client.removeUris(uris);
    }
    for (const uri of uris) {
      const m: LibraryMembershipT = {
        uri,
        kind: inferKind(uri),
        state: targetState,
        updatedAt: Date.now(),
      };
      if (cache) {
        try {
          cache.putQuery(accountId, `membership:v1:${uri}`, m, 60_000);
        } catch {
          // Non-fatal
        }
      }
    }
    return { ok: true };
  } catch (err: unknown) {
    for (const [uri, state] of priorState.entries()) {
      const m: LibraryMembershipT = {
        uri,
        kind: inferKind(uri),
        state,
        updatedAt: Date.now(),
      };
      if (cache) {
        try {
          cache.putQuery(accountId, `membership:v1:${uri}`, m, 60_000);
        } catch {
          // Non-fatal
        }
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
