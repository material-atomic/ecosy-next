/* Net under `src/request-store.ts`, called directly — it is not on
   `../dist/index.js` (main exports 15 modules and this is not one of them).
   Time is faked by monkey-patching `Date.now` in try/finally, the shape
   already used in `tests/request-id.test.mjs`'s "the handoff store is
   bounded" test — not `mock.timers`, which is not this repo's convention.
   The 10 000-entry cap already has a test in request-id.test.mjs; it is not
   repeated here. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RequestStore } = require("../dist/request-store.js");

/* The Map is created lazily on first use, inside request-store.ts's own
   `store()` — reading the symbol at import time would see it before it
   exists, so this looks it up fresh each call instead of caching it. */
const store = () => globalThis[Symbol.for("@ecosy/next:request-store")];

/** Runs `fn` with `Date.now()` pinned to `now`, restoring the real clock after. */
function withClock(now, fn) {
  const real = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

/* ---------------------------------------------------------------------- */
/* 7. claim never returns the same entry twice; peek never removes it.    */
/* ---------------------------------------------------------------------- */

test("write then peek twice both see the value — peek does not remove it", () => {
  RequestStore.write("rs-peek-twice", "a", 1);
  assert.deepEqual(RequestStore.peek("rs-peek-twice"), { a: 1 });
  assert.deepEqual(RequestStore.peek("rs-peek-twice"), { a: 1 });
});

test("claim on an id that was never written returns {}, not undefined", () => {
  assert.deepEqual(RequestStore.claim("rs-never-written-claim"), {});
});

test("peek on an id that was never written returns undefined", () => {
  assert.equal(RequestStore.peek("rs-never-written-peek"), undefined);
});

test("write then claim: claim returns the value once, and a second claim for the same id gets {} — not undefined", () => {
  RequestStore.write("rs-claim-once", "a", 1);
  assert.deepEqual(RequestStore.claim("rs-claim-once"), { a: 1 });
  assert.deepEqual(RequestStore.claim("rs-claim-once"), {});
});

test("writing two different keys to the same id merges them into one entry", () => {
  RequestStore.write("rs-merge-keys", "a", 1);
  RequestStore.write("rs-merge-keys", "b", 2);
  assert.deepEqual(RequestStore.peek("rs-merge-keys"), { a: 1, b: 2 });
});

test("writing the same key twice to the same id keeps the later value", () => {
  RequestStore.write("rs-overwrite-key", "a", 1);
  RequestStore.write("rs-overwrite-key", "a", 2);
  assert.deepEqual(RequestStore.peek("rs-overwrite-key"), { a: 2 });
});

/* ---------------------------------------------------------------------- */
/* 8. An expired entry is never readable; a live entry is never pruned    */
/* for being expired.                                                     */
/* ---------------------------------------------------------------------- */

test("an entry 61s old is unreadable: peek returns undefined and claim returns {}", () => {
  const t0 = Date.now();
  withClock(t0, () => RequestStore.write("rs-ttl-expired", "a", 1));
  withClock(t0 + 61_000, () => {
    assert.equal(RequestStore.peek("rs-ttl-expired"), undefined);
    assert.deepEqual(RequestStore.claim("rs-ttl-expired"), {});
  });
});

test("an entry 59s old is still readable via peek", () => {
  const t0 = Date.now();
  withClock(t0, () => RequestStore.write("rs-ttl-still-good", "a", 1));
  withClock(t0 + 59_000, () => {
    assert.deepEqual(RequestStore.peek("rs-ttl-still-good"), { a: 1 });
  });
});

test("an entry exactly 60000ms old is expired — the comparison is strict expires > now", () => {
  const t0 = Date.now();
  withClock(t0, () => RequestStore.write("rs-ttl-exact-boundary", "a", 1));
  withClock(t0 + 60_000, () => {
    assert.equal(RequestStore.peek("rs-ttl-exact-boundary"), undefined);
    assert.deepEqual(RequestStore.claim("rs-ttl-exact-boundary"), {});
  });
});

test("writing to an existing id extends its expiry from the time of the second write, and keeps the earlier value merged", () => {
  const t0 = Date.now();
  withClock(t0, () => RequestStore.write("rs-ttl-extend", "a", 1));
  withClock(t0 + 50_000, () => RequestStore.write("rs-ttl-extend", "b", 2));

  /* Past the FIRST write's original 60s (t0+60_000) but well inside the
     extended one (t0+50_000+60_000 = t0+110_000). Only observable if the
     second write actually reset the countdown. */
  withClock(t0 + 65_000, () => {
    assert.deepEqual(RequestStore.peek("rs-ttl-extend"), { a: 1, b: 2 });
  });
});

test("a stale entry ahead of a fresh one in Map order is pruned by the next write, and the fresh one is untouched", () => {
  /* prune() only deletes a contiguous prefix from the FRONT of the Map, and
     stops at the first entry it finds still live. This file's earlier
     "extend" test left an entry with a deliberately long remaining life
     sitting ahead of anything this test writes — left alone, that entry
     would block prune() before it ever reaches this test's own stale one,
     which is the exact failure the assertions below would otherwise miss.
     Jumping far enough into the future first, with one throwaway write,
     makes every leftover entry stale and lets its own trailing prune() call
     clear the Map down to a known state before the real experiment. */
  const t0 = Date.now() + 10 * 60_000;
  withClock(t0, () => RequestStore.write("rs-prune-flush", "x", 1));

  withClock(t0, () => RequestStore.write("rs-prune-stale", "a", "old"));
  withClock(t0 + 61_000, () => RequestStore.write("rs-prune-fresh", "a", "new"));

  assert.equal(store().has("rs-prune-stale"), false, "the expired entry was actually deleted from the Map, not just unreadable");
  assert.deepEqual(RequestStore.peek("rs-prune-fresh"), { a: "new" });
});

test("write() re-inserts an existing id at the end of the Map's iteration order", () => {
  RequestStore.write("rs-order-a", "k", 1);
  RequestStore.write("rs-order-b", "k", 2);
  RequestStore.write("rs-order-a", "k", 3);

  const order = [...store().keys()].filter((id) => id === "rs-order-a" || id === "rs-order-b");
  assert.deepEqual(order, ["rs-order-b", "rs-order-a"]);
});

/* ---------------------------------------------------------------------- */
/* prune()'s own invariants — not asked for by name in 0021's numbered     */
/* list, but each one is what the mutation floor's items 18, 19 and the   */
/* write()/merge boundary actually exercise. peek() and claim() re-check  */
/* expiry themselves, so none of these three is visible through them —    */
/* only a direct look at the underlying Map tells break from continue, or */
/* an exact-boundary write from a merge. That's why each flushes the      */
/* shared Map first: any leftover live entry ahead of the one under test  */
/* would hide the difference the same way it did above. */
/* ---------------------------------------------------------------------- */

test("prune() stops at the first live entry in Map order rather than scanning past it, so a backdated-expired entry sitting behind two live ones is not removed", () => {
  /* Only reachable by moving the mocked clock backwards between writes —
     real usage never does that, Date.now() is monotonic — but it is the
     one arrangement that tells "stop at the first live entry" (break)
     apart from "skip live entries and keep scanning" (continue): both read
     as expired through peek/claim either way, since those re-check expiry
     themselves regardless of what prune() has physically removed. */
  const future = Date.now() + 20 * 60_000;
  withClock(future, () => RequestStore.write("rs-scan-flush", "x", 1));

  withClock(future, () => RequestStore.write("rs-scan-live", "a", 1));
  withClock(future - 100_000, () => RequestStore.write("rs-scan-backdated", "a", 1));
  withClock(future, () => RequestStore.write("rs-scan-trigger", "a", 1));

  assert.equal(
    store().has("rs-scan-backdated"),
    true,
    "prune() broke out at rs-scan-flush (still live at `future`) before ever reaching this entry",
  );
});

test("prune() treats an entry exactly at its expiry as expired, the same strict > as peek/claim use, not >=", () => {
  const future = Date.now() + 30 * 60_000;
  withClock(future, () => RequestStore.write("rs-boundary-flush", "x", 1));

  withClock(future, () => RequestStore.write("rs-boundary-entry", "a", 1));
  /* At this exact instant rs-boundary-flush's and rs-boundary-entry's expires
     both equal `now` — expired under `>`, still "live" under `>=`. */
  withClock(future + 60_000, () => RequestStore.write("rs-boundary-trigger", "a", 1));

  assert.equal(store().has("rs-boundary-entry"), false, "an entry exactly at its expiry is expired, so prune() should have reached and removed it");
});

test("write() to an id exactly at its previous entry's expiry boundary starts fresh rather than merging the stale value in", () => {
  const t0 = Date.now() + 40 * 60_000;
  withClock(t0, () => RequestStore.write("rs-merge-boundary", "old", "stale"));
  /* current.expires === now here: expired under the strict `>` write() uses
     to decide whether to merge, so the stale "old" key must not survive. */
  withClock(t0 + 60_000, () => RequestStore.write("rs-merge-boundary", "new", "fresh"));

  assert.deepEqual(RequestStore.peek("rs-merge-boundary"), { new: "fresh" });
});
