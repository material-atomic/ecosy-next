/* Net under `src/request-store.ts`, called directly — it is not on
   `../dist/index.js` (main exports 15 modules and this is not one of them).
   Time is faked by monkey-patching `Date.now` in try/finally, the shape
   already used in `tests/request-id.test.mjs`'s "the handoff store is
   bounded" test — not `mock.timers`, which is not this repo's convention.
   The 10 000-entry cap already has a test in request-id.test.mjs; it is not
   repeated here. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RequestStore } = require("../dist/request-store.js");

/* The Map is created lazily on first use, inside request-store.ts's own
   `store()` — reading the symbol at import time would see it before it
   exists, so this looks it up fresh each call instead of caching it. */
const store = () => globalThis[Symbol.for("@ecosy/next:request-store")];

/* 0039: this file used to buy test-order independence by having each test's
   first write land at a moment further in the future than the one before it
   (+10min, +20min, +30min, +40min) — far enough that its own `prune()` swept
   away whatever the previous tests left behind. That trick is *why* the file
   only passed in the order it was written: reverse the blocks and two go
   red, because the "further into the future" escalation only works forward.
   0023–0027 all still insert tests into this exact file, so a rule that only
   holds in one order is a trap for every one of them.
   Replaced with a fact about the store itself, asserted once, up front: it
   starts every test empty. `?.` is required, not decorative — `store()` (the
   real one, in request-store.ts) creates the Map lazily on the first write,
   so before that first write this file's own `store()` helper above sees
   `undefined`, and `undefined.clear()` would throw. */
beforeEach(() => { store()?.clear(); });

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

/* Mutant, run and left unpatched, but on a corrected premise (0039 round 3):
   `claim` returning `{ ...entry.values }` (a shallow copy) instead of
   `entry.values` itself. The earlier version of this note claimed "nothing
   else in the process still holds a reference to compare against" because
   the line above `claim`'s return already deletes the id from the Map —
   that premise is false, and measurably so: `peek(id)` does NOT delete,
   so calling `peek(id)` and then `claim(id)` on the same id captures a
   reference to the exact same `values` object `claim` is about to return.
   Measured directly against the real, unmutated code:
   `RequestStore.write(id, "a", 1)` then `RequestStore.peek(id) ===
   RequestStore.claim(id)` is `true` today. A caller COULD hold that
   reference and compare by `===`. The conclusion — don't patch — still
   holds, but for the narrower, actual reason: nothing in this package's
   own code ever does that comparison. Every caller of claim()/peek() reads
   values by key, never by object identity, so a shallow-copy mutant here
   changes nothing any real caller observes, even though "no one COULD
   hold a reference" was the wrong justification. See the matching
   correction beside the header-copy tests in context.test.mjs for the
   same shape of mistake on the other side of this file. */

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
     stops at the first entry it finds still live. beforeEach already left
     the Map empty, so "rs-prune-stale" is the only — and therefore front —
     entry once written, with nothing ahead of it to block prune() before it
     reaches this test's own stale entry. */
  const t0 = Date.now();
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
/* an exact-boundary write from a merge. beforeEach already starts each   */
/* one from an empty Map, so — unlike before 0039 — nothing here needs to */
/* flush a leftover entry first: the only entries in play are the ones    */
/* each test writes for itself. */
/* ---------------------------------------------------------------------- */

test("prune() stops at the first live entry in Map order rather than scanning past it, so a backdated-expired entry sitting behind a live one is not removed", () => {
  /* Only reachable by moving the mocked clock backwards between writes —
     real usage never does that, Date.now() is monotonic — but it is the
     one arrangement that tells "stop at the first live entry" (break)
     apart from "skip live entries and keep scanning" (continue): both read
     as expired through peek/claim either way, since those re-check expiry
     themselves regardless of what prune() has physically removed. */
  const now = Date.now();
  withClock(now, () => RequestStore.write("rs-scan-live", "a", 1));
  withClock(now - 100_000, () => RequestStore.write("rs-scan-backdated", "a", 1));
  withClock(now, () => RequestStore.write("rs-scan-trigger", "a", 1));

  assert.equal(
    store().has("rs-scan-backdated"),
    true,
    "prune() broke out at rs-scan-live (still live at `now`) before ever reaching this entry",
  );
});

test("prune() treats an entry exactly at its expiry as expired, the same strict > as peek/claim use, not >=", () => {
  const now = Date.now();
  withClock(now, () => RequestStore.write("rs-boundary-entry", "a", 1));
  /* At this exact instant rs-boundary-entry's expires equals `now` — expired
     under `>`, still "live" under `>=`. */
  withClock(now + 60_000, () => RequestStore.write("rs-boundary-trigger", "a", 1));

  assert.equal(store().has("rs-boundary-entry"), false, "an entry exactly at its expiry is expired, so prune() should have reached and removed it");
});

test("write() to an id exactly at its previous entry's expiry boundary starts fresh rather than merging the stale value in", () => {
  const t0 = Date.now();
  withClock(t0, () => RequestStore.write("rs-merge-boundary", "old", "stale"));
  /* current.expires === now here: expired under the strict `>` write() uses
     to decide whether to merge, so the stale "old" key must not survive. */
  withClock(t0 + 60_000, () => RequestStore.write("rs-merge-boundary", "new", "fresh"));

  assert.deepEqual(RequestStore.peek("rs-merge-boundary"), { new: "fresh" });
});

/* ---------------------------------------------------------------------- */
/* 14. 0022 adds a "$" prefix to every key one layer up, in Context, and  */
/*     specifically NOT here — the boundary the task draws is that a key */
/*     arriving at write()/peek() already carries the prefix, so a       */
/*     literal string like "$__proto__" must behave as nothing more      */
/*     than an ordinary string key at this layer. It already does,       */
/*     unchanged: only the bare string "__proto__" ever triggers the     */
/*     accessor, and "$__proto__" is a different string. This documents  */
/*     that contract without touching request-store.ts.                 */
/* ---------------------------------------------------------------------- */

test('write() and peek() treat "$__proto__" as an ordinary key, not a prototype write — only the bare "__proto__" string triggers that accessor', () => {
  RequestStore.write("rs-dollar-proto", "$__proto__", { a: 1 });

  const stored = RequestStore.peek("rs-dollar-proto");
  assert.deepEqual(stored, { $__proto__: { a: 1 } });
  assert.equal(Object.getPrototypeOf(stored), Object.prototype, "the entry's own prototype was not touched by a key that merely starts with the same characters");

  /* The claim above — "only the bare __proto__ string triggers that accessor" —
     was never actually exercised: the test only ever wrote "$__proto__". Prove
     the contrast by writing the bare string too, on a fresh id, and showing it
     DOES reach the accessor: values["__proto__"] = X sets the entry's own
     [[Prototype]] rather than creating an own, enumerable "__proto__" key. This
     is exactly why the prefix has to be added one layer up, in Context, before
     a key ever reaches this file's plain `values[key] = value`. */
  RequestStore.write("rs-bare-proto", "__proto__", { a: 1 });
  const bareStored = RequestStore.peek("rs-bare-proto");
  assert.deepEqual(Object.keys(bareStored), [], "the bare __proto__ write should not have created an own enumerable key");
  assert.equal(Object.getPrototypeOf(bareStored).a, 1, "the bare __proto__ write should have reached the accessor and become the entry's own prototype");
});
