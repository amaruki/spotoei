// Stable protocol major version. Increment on breaking envelope/semantic
// changes. Lives in its own module to avoid circular imports between
// `index.ts` and the per-domain schema modules (e.g. `auth.ts`).
export const PROTOCOL_VERSION = 1 as const;
