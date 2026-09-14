// Parallel all-pages fetching in the spirit of spotify-player's
// `all_paging_items` (PAGE_LIMIT 50, MAX_PARALLEL 8): fetch every remaining
// page of a listing with bounded parallelism instead of one request at a
// time. Rejects on the first page failure (same all-or-nothing contract);
// callers that want best-effort behavior catch and keep partial state.

export interface PagedResult<T> {
  items: T[];
  total: number;
}

export interface FetchAllOptions {
  startOffset?: number;
  pageLimit?: number;
  maxParallel?: number;
  knownTotal?: number;
  signal?: AbortSignal;
}

const PAGE_LIMIT = 50;
const MAX_PARALLEL = 8;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<PagedResult<T>>,
  opts: FetchAllOptions = {},
): Promise<PagedResult<T>> {
  const startOffset = Math.max(0, Math.floor(opts.startOffset ?? 0));
  const pageLimit = Math.min(
    50,
    Math.max(1, Math.floor(opts.pageLimit ?? PAGE_LIMIT) || PAGE_LIMIT),
  );
  const maxParallel = Math.min(
    16,
    Math.max(1, Math.floor(opts.maxParallel ?? MAX_PARALLEL) || MAX_PARALLEL),
  );
  const signal = opts.signal;

  const out: T[] = [];
  let total = opts.knownTotal !== undefined ? Math.max(0, Math.floor(opts.knownTotal)) : -1;
  let offset = startOffset;

  for (;;) {
    throwIfAborted(signal);
    if (total >= 0) {
      const remaining = total - offset;
      if (remaining <= 0) break;
      const jobs = Math.min(maxParallel, Math.ceil(remaining / pageLimit));
      // oxlint-disable-next-line no-await-in-loop -- await is a parallel Promise.all batch
      const pages = await Promise.all(
        Array.from({ length: jobs }, (_, i) => fetchPage(offset + i * pageLimit, pageLimit)),
      );
      for (const page of pages) {
        if (typeof page.total === 'number' && page.total >= 0) total = Math.floor(page.total);
        out.push(...page.items);
      }
      offset += jobs * pageLimit;
    } else {
      // oxlint-disable-next-line no-await-in-loop -- await is a parallel Promise.all batch
      const pages = await Promise.all(
        Array.from({ length: maxParallel }, (_, i) => fetchPage(offset + i * pageLimit, pageLimit)),
      );
      let empty = false;
      for (const page of pages) {
        if (typeof page.total === 'number' && page.total >= 0) total = Math.floor(page.total);
        if (page.items.length === 0) {
          empty = true;
          break;
        }
        out.push(...page.items);
      }
      if (empty) break;
      offset += maxParallel * pageLimit;
    }
  }

  return { items: out, total: total < 0 ? startOffset + out.length : total };
}
