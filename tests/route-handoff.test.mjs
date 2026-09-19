/* 0023 phần B. `tests/request-id.test.mjs` already has the shape this file
   needs — a real Gateway issuing a signed id, a real Route claiming it through
   `dist` — but it is on the "cấm sửa" list for this task (it has to stay
   green with not one line touched, since it is the net for 0014/0021/0039).
   This file exists because `route.ts`'s `takeProxyValues` (line ~133) is
   allowed to be RIGHT without anyone having written the test that would
   catch it going wrong: Reviewer 0022 found, by hand-patching `dist/route.js`
   and restoring it byte-for-byte, that swapping `RequestStore.claim(header)`
   for `RequestStore.peek(header) ?? {}` survives the entire existing suite
   (79/79 green at the time). Not because the swap is safe — because every
   existing test only ever reads VALUES back out of the bag, and `peek`
   returns the exact same object `claim` would have, so no value is
   ever wrong. What differs is whether the entry is actually gone from the
   store afterward, and nothing before this file asked that question directly.

   Not added to `tests/request-store.test.mjs` either: that file calls
   `RequestStore` directly and never builds a `Route`, so it cannot see
   `takeProxyValues` at all — the bug lives in how `route.ts` USES the store,
   not in the store itself (0039 already covers the store's own claim/peek
   contract).

   The store is read through `globalThis[Symbol.for("@ecosy/next:request-store")]`
   directly, matching `tests/request-store.test.mjs:18` and
   `tests/request-id.test.mjs:104` — not through any exported helper, since
   there isn't one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Route, Gateway } = require("../dist/index.js");
const { NextRequest } = require("next/server");

const ID = "x-ecosyrequest-id";
const FORWARDED = "x-middleware-request-";
const payload = () => ({ params: Promise.resolve({}) });
const url = (path = "/api/x") => `http://localhost${path}`;

/** The request headers a proxy response forwards, as Next reads them.
 *  Same shape as `tests/request-id.test.mjs`'s own `forwarded()` — not
 *  imported from there on purpose: importing that file would run its
 *  top-level tests too, and duplicating six lines is cheaper than a shared
 *  helper module for a test-only function this small. */
function forwarded(response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name.startsWith(FORWARDED)) headers.set(name.slice(FORWARDED.length), value);
  }
  return headers;
}

/** The live handoff Map, looked up fresh each call — see the same note in
 *  `tests/request-store.test.mjs` on why this cannot be cached at import
 *  time: `request-store.ts`'s own `store()` creates it lazily, on first
 *  write, and this file's first assertion runs after that write has already
 *  happened, so the lazy-creation case that needs `?.` does not arise here —
 *  but the lookup is still done fresh, not cached, in case a future test in
 *  this file ever wants to run before any write. */
const store = () => globalThis[Symbol.for("@ecosy/next:request-store")];

/* ---------------------------------------------------------------------- */
/* 7. A Route that finishes a request never leaves that request's entry    */
/* sitting in the handoff store — claimed, not merely read.                */
/* ---------------------------------------------------------------------- */

test("after a GET reads back what the proxy set, the entry is gone from the store's Map — not just left present with its values emptied", async () => {
  const proxy = Gateway({}).use((ctx) => ctx.set("userId", "u-handoff-1"));
  const id = forwarded(await proxy(new NextRequest(url("/api/x")), payload())).get(ID);

  const { GET } = Route().get((ctx) => ctx.get("userId") ?? null);
  const res = await GET(new NextRequest(url(), { headers: { [ID]: id } }), payload());
  assert.equal((await res.json()).data, "u-handoff-1", "the route did not read back what the proxy set — takeProxyValues is not wired to claim() at all");

  /* This is the assertion "a route takes what the proxy set, once: the same
     id sent again finds nothing" (tests/request-id.test.mjs) does not make:
     that test only reads a SECOND time and sees `null`, which a bag emptied
     in place by destroy() also produces — RequestStore.peek(id) ?? {} passes
     that test too (see this file's header comment). Only looking at the Map
     itself — whether the id is still a key in it at all — tells `claim`
     (deletes the Map entry) apart from `peek` (leaves the Map entry sitting,
     TTL'd, taking a slot in MAX_ENTRIES, just with its `values` object
     emptied out from under it by Context.destroy()'s `finally`). */
  assert.equal(store().has(id), false, "the id must not still be a key in the store's Map after a successful GET claimed it");
});

/* ---------------------------------------------------------------------- */
/* 7. Two requests carrying the same id — one still running when the       */
/* second starts — never end up sharing one bag.                          */
/* ---------------------------------------------------------------------- */

test("a second request with the same id, dispatched only after the first has already claimed it, gets nothing of its own — the two never share one bag", async () => {
  const proxy = Gateway({}).use((ctx) => ctx.set("userId", "u-concurrent"));
  const id = forwarded(await proxy(new NextRequest(url("/api/x")), payload())).get(ID);

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let announceEntered;
  const entered = new Promise((resolve) => { announceEntered = resolve; });
  let calls = 0;

  /* Only the FIRST call (A) blocks. This is deliberate, not a shortcut: if
     both A and B waited on the same `held` promise and were released
     together, which one's continuation the microtask queue runs first is an
     implementation detail of Promise reaction ordering, not something this
     test should depend on — and getting it wrong is exactly how `peek(e) ??
     {}` could look correct here for the WRONG reason (A's own `destroy()`
     racing ahead of B's read and wiping the shared object before B ever
     looks at it, rather than B genuinely holding its own empty bag). Letting
     B run to completion — claim, read, destroy — strictly BEFORE `release()`
     is ever called removes that race: B's entire lifecycle is observed to
     finish while A is still provably parked mid-handler, never having run
     its own `finally`. */
  const { GET } = Route().get(async (ctx) => {
    calls += 1;
    if (calls === 1) {
      announceEntered();
      await held;
    }
    return ctx.get("userId") ?? null;
  });

  const reqA = GET(new NextRequest(url(), { headers: { [ID]: id } }), payload());
  await entered; // A has claimed the entry and is parked on `held`, destroy() not yet run

  const resB = await GET(new NextRequest(url(), { headers: { [ID]: id } }), payload());
  assert.equal(
    (await resB.json()).data,
    null,
    "B — whose claim() call happens after A's has already removed the entry, and which fully completes (claim, read, destroy) before A is even released — must get an empty bag of its own, not a live reference into the one A is still using: peek(e) would hand B the SAME object A holds, so B would read u-concurrent too",
  );

  release();
  const resA = await reqA;
  assert.equal((await resA.json()).data, "u-concurrent", "A must still read what the proxy set, after B's whole lifecycle ran and finished");
});

/* ---------------------------------------------------------------------- */
/* 7. The reverse case, so the two tests above are not vacuous: a validly  */
/* signed id nothing was ever written under must NOT throw — it must      */
/* answer with an empty bag, having already cleared checkRequestId.        */
/* ---------------------------------------------------------------------- */

test("a validly signed id that nothing was ever written under reaches the handler with an empty bag, not a thrown error — checkRequestId already let it through", async () => {
  /* No middleware here — `ctx.set` never runs, so RequestStore never gets a
     write for this id at all. Distinct from an id that IS foreign or
     malformed (already covered by tests/request-id.test.mjs's "a route
     refuses an altered id, and a request with none", out of scope for this
     file): this id is real, signed by this same process's Gateway, and simply
     has nothing sitting in the store for it — the ordinary case of a proxied
     page route, or an /api/ route no middleware bothered to `set` anything
     on. Written explicitly so a report distinguishes THIS test's failure
     (constructor-time TypeError, if `claim` were ever swapped for a bare
     `peek` with no `?? {}` fallback — see mutation 15 in the Kết quả table)
     from the previous two tests' failure (a wrong `.data` or a live
     `store().has(id)`), rather than all three reading as "the same thing
     broke". */
  const proxy = Gateway({});
  const id = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(ID);

  const { GET } = Route().get((ctx) => ctx.get("anything") ?? "empty-ok");
  const res = await GET(new NextRequest(url(), { headers: { [ID]: id } }), payload());
  assert.equal((await res.json()).data, "empty-ok", "a signed id with nothing ever written for it must answer normally with an empty bag, not fail");
});
