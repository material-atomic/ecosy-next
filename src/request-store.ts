/** The header a {@link Proxy} forwards its request id in. */
export const REQUEST_ID = "x-ecosyrequest-id";

const STORE_KEY = Symbol.for("@ecosy/next:request-store");

/** More than this and the least recently written entries go first. */
const MAX_ENTRIES = 10_000;

/**
 * How long an entry waits for its route.
 *
 * Not a replay window — a route takes its entry out as it starts, so an id sent
 * a second time finds nothing however soon. It is how long a proxy's values
 * survive for a route that has not started yet, and `next dev` compiling a
 * route for the first time can take longer than a few seconds.
 */
const TTL_MS = 60_000;

interface Entry {
  values: Record<string, unknown>;
  expires: number;
}

type Holder = typeof globalThis & { [STORE_KEY]?: Map<string, Entry> };

/* On `globalThis`: the proxy and the route are compiled into separate module
   graphs, and only the process-wide object is shared between them. */
function store(): Map<string, Entry> {
  const holder = globalThis as Holder;
  if (!holder[STORE_KEY]) holder[STORE_KEY] = new Map();
  return holder[STORE_KEY];
}

/* Map keeps insertion order and `write` re-inserts, so the front holds the least
   recently written entries — and, every entry living the same TTL, the ones that
   expire first. Pruning stops at the first entry that is neither. */
function prune(map: Map<string, Entry>, now: number) {
  for (const [id, entry] of map) {
    if (map.size <= MAX_ENTRIES && entry.expires > now) break;
    map.delete(id);
  }
}

/**
 * What a {@link Proxy} hands to the {@link Route} that serves the same request,
 * keyed by the request's signed id.
 *
 * Bounded both ways: every request through a proxy whose middleware sets a
 * value leaves an entry, and one no route takes — a page, an asset — used to
 * stay for the life of the process.
 */
export const RequestStore = {
  write(id: string, key: string, value: unknown) {
    const map = store();
    const now = Date.now();
    const current = map.get(id);
    const values = current && current.expires > now ? current.values : {};

    values[key] = value;
    map.delete(id);
    map.set(id, { values, expires: now + TTL_MS });
    prune(map, now);
  },

  /** The values under `id`, left in place. */
  peek(id: string): Record<string, unknown> | undefined {
    const entry = store().get(id);
    return entry && entry.expires > Date.now() ? entry.values : undefined;
  },

  /** The values under `id`, removed — the second call for the same id gets nothing. */
  claim(id: string): Record<string, unknown> {
    const map = store();
    const entry = map.get(id);
    map.delete(id);
    return entry && entry.expires > Date.now() ? entry.values : {};
  },
};
