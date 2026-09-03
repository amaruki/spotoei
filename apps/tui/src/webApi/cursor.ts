// Cursor-based and offset-based pagination helper. Follows `next` links or
// cursors up to `maxPages` without unbounded recursion.

export async function followNextCursor<T>(
  first: T,
  fetchNext: (url: string) => Promise<T | null>,
  getNextUrl: (page: T) => string | undefined | null,
  combine: (accum: T, page: T) => T,
  maxPages = 5,
): Promise<T> {
  let current = first;
  let pages = 1;
  let nextUrl = getNextUrl(current);
  while (nextUrl && pages < maxPages) {
    // eslint-disable-next-line no-await-in-loop
    const nextPage = await fetchNext(nextUrl);
    if (!nextPage) break;
    current = combine(current, nextPage);
    nextUrl = getNextUrl(nextPage);
    pages++;
  }
  return current;
}
