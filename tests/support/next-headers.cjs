/* Stub for `next/headers`, resolved through `tests/hooks.mjs`'s `--import`
   hook exactly the way `server-only` already is (see the `resolve` branch
   added there for 0024). `cookies()` throws outside a real Next request, and
   `cookie-jar.ts` calls it unconditionally on every path, so nothing in that
   file is testable without a stand-in.

   One shared store lives on `globalThis` under a `Symbol.for` key. Two
   different module graphs need to see the SAME store: `hooks.mjs` loads this
   file through the ESM resolve hook (whatever graph `dist/cookie-jar.*`
   ends up in when it does `import { cookies } from "next/headers"`), and
   `tests/cookie-jar.test.mjs` loads it again through `createRequire` — the
   same pattern `request-id.test.mjs` uses for `dist/index.js` — to call
   `reset()`/`seed()`/`sets()`. `Symbol.for` interns across both graphs onto
   one process-wide registry, so both resolve to the one Map no matter which
   graph got there first.

   `store.get(name)` deliberately never reflects a `set()` made on the SAME
   store — that is the one behavior this stub exists to model, not an
   oversight. Measured on real Next 16.3.4 (cookie-jar.ts's own comment):
   `cookies().get()` keeps returning the request's original value even after
   `cookies().set()` on the identical store, because the read side is a
   snapshot taken before the response is built and the write side only ever
   produces `Set-Cookie` headers — it does not rewrite what the read side
   answers. Getting this wrong here — letting `set()` feed back into `get()`
   — would hide the exact bug `written` (cookie-jar.ts's own in-memory
   overlay) exists to paper over, and would make mutation 1 in the task
   (`written.has(name)` forced to `false`, i.e. read the store directly)
   invisible: `store.get()` alone would already return the fresh value, so
   skipping `written` entirely would still look correct. */
const KEY = Symbol.for("@ecosy/next:test-next-headers-store");

function state() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = { requestCookies: new Map(), sets: [] };
  }
  return globalThis[KEY];
}

/** Test-only: clears every seeded cookie and every recorded `set()` call.
 *  The store is one process-wide Map — a test that forgets this reads
 *  whatever the previous test left behind. */
function reset() {
  const s = state();
  s.requestCookies = new Map();
  s.sets = [];
}

/** Test-only: seeds the cookies the "incoming request" carries, as if a
 *  browser had sent them. This is exactly what `store.get()` answers with,
 *  and — per the note above — it never changes once seeded, no matter how
 *  many times `store.set()` is called afterward. */
function seed(entries) {
  const s = state();
  for (const [name, value] of Object.entries(entries)) {
    s.requestCookies.set(name, value);
  }
}

/** Test-only: every `set(name, value, options)` call made so far, in the
 *  order it happened. §5's delete-option assertions read the last entry. */
function sets() {
  return state().sets;
}

async function cookies() {
  const s = state();
  return {
    get(name) {
      if (!s.requestCookies.has(name)) return undefined;
      return { value: s.requestCookies.get(name) };
    },
    set(name, value, options) {
      s.sets.push({ name, value, options });
    },
  };
}

module.exports = { cookies, reset, seed, sets };
