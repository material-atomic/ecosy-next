/* Net under `src/context.ts`, ahead of 0022/0023/0024/0025/0026/0027 touching it.
   Every test here hunts a counter-example to one of the promises listed in
   0021, not just a happy path. `ctx.next()` is deliberately untested — its
   behavior is 0023's, and about to change. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { Context, Memory, Proxy, Route } = require("../dist/index.js");
const { RequestStore } = require("../dist/request-store.js");
const { NextRequest } = require("next/server");

const REQUEST_ID = "x-ecosyrequest-id";
const MEMORY_MAP = globalThis[Symbol.for("@ECOSY/CONTEXT_MEMORY")];
const url = (path = "/api/x") => `http://localhost${path}`;

/* ---------------------------------------------------------------------- */
/* 1. Memory never changes what it's given, and remove never touches      */
/*    another key.                                                        */
/* ---------------------------------------------------------------------- */

test("Memory.get returns the exact same object reference that was set, not a copy", () => {
  const obj = { a: 1 };
  Memory.set("ctx-mem-obj", obj);
  assert.strictEqual(Memory.get("ctx-mem-obj"), obj);
});

test("Memory.set returns the value it was given, for chaining", () => {
  const result = Memory.set("ctx-mem-return", 42);
  assert.equal(result, 42);
});

test("Memory.get answers undefined for both an unset key and a key set to undefined, but the underlying Map tells them apart", () => {
  Memory.set("ctx-mem-explicit-undefined", undefined);

  assert.equal(Memory.get("ctx-mem-never-set"), undefined);
  assert.equal(Memory.get("ctx-mem-explicit-undefined"), undefined);

  assert.equal(MEMORY_MAP.has("ctx-mem-never-set"), false, "a key nobody set is not in the Map at all");
  assert.equal(MEMORY_MAP.has("ctx-mem-explicit-undefined"), true, "a key set to undefined IS in the Map");
});

test("Memory.set stores null, 0, an empty string and false without altering any of them", () => {
  const cases = [["ctx-mem-null", null], ["ctx-mem-zero", 0], ["ctx-mem-empty", ""], ["ctx-mem-false", false]];
  for (const [key, value] of cases) {
    Memory.set(key, value);
    assert.strictEqual(Memory.get(key), value, `Memory changed ${JSON.stringify(value)}`);
  }
});

test("Memory.set overwriting the same key twice keeps only the second value", () => {
  Memory.set("ctx-mem-overwrite", "first");
  Memory.set("ctx-mem-overwrite", "second");
  assert.equal(Memory.get("ctx-mem-overwrite"), "second");
});

test("Memory.remove drops the given key and leaves the other two keys in the store untouched", () => {
  Memory.set("ctx-mem-k1", "v1");
  Memory.set("ctx-mem-k2", "v2");
  Memory.set("ctx-mem-k3", "v3");

  Memory.remove("ctx-mem-k2");

  assert.equal(Memory.get("ctx-mem-k1"), "v1");
  assert.equal(Memory.get("ctx-mem-k3"), "v3");
  assert.equal(MEMORY_MAP.has("ctx-mem-k2"), false, "the removed key is actually gone from the Map, not just shadowed");
});

test("Memory.remove on a key that was never set neither throws nor changes the store's size", () => {
  const before = MEMORY_MAP.size;
  assert.doesNotThrow(() => Memory.remove("ctx-mem-was-never-set-xyz"));
  assert.equal(MEMORY_MAP.size, before);
});

/* ---------------------------------------------------------------------- */
/* 2. Two Contexts on the local branch never see each other's state.      */
/* ---------------------------------------------------------------------- */

test("two local Contexts never see the value the other one set under the same key", () => {
  const ctx1 = new Context(new NextRequest(url()), {});
  const ctx2 = new Context(new NextRequest(url()), {});

  ctx1.set("who", "ctx1");
  ctx2.set("who", "ctx2");

  assert.equal(ctx1.get("who"), "ctx1");
  assert.equal(ctx2.get("who"), "ctx2");
});

test("a third local Context built after the others starts with no values of its own", () => {
  const ctx1 = new Context(new NextRequest(url()), {});
  ctx1.set("carried", "from ctx1");

  const ctx3 = new Context(new NextRequest(url()), {});
  assert.equal(ctx3.get("carried"), undefined);
});

test("a local Context built with no fourth constructor argument defaults to its own empty local branch", () => {
  const ctx = new Context(new NextRequest(url()), {});
  assert.deepEqual(ctx.values, { local: {} });
});

/* A shared-branch Context is the shape 0022/0023/0024 will keep changing, but
   Context.get reading through RequestStore rather than a local object is
   this task's to net — the branch itself is already exercised end to end via
   Proxy→Route in request-id.test.mjs.

   0022 update: Context.set now adds a "$" prefix before a key ever reaches
   RequestStore, so the physical key is "$k", not "k" — this is the exact
   shape change the comment above already expected. Checking Object.values
   here rather than the literal key name, since that name is exactly what
   0023/0024 may still move again; the prefix itself gets its own dedicated
   test in section 11 below. */
test("Context.set and Context.get on a shared-branch Context round-trip through RequestStore, not a local object", () => {
  const id = "ctx-shared-roundtrip";
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });

  ctx.set("k", "v");

  assert.equal(ctx.get("k"), "v");
  assert.deepEqual(Object.values(RequestStore.peek(id)), ["v"], "the value actually landed in RequestStore under the shared id");
});

/* ---------------------------------------------------------------------- */
/* 3. Context.set never writes into Memory.                               */
/* ---------------------------------------------------------------------- */

test("Context.set never adds anything to Memory, on the local branch or the shared branch", () => {
  const before = MEMORY_MAP.size;

  const local = new Context(new NextRequest(url()), {});
  local.set("a", 1);
  local.set("b", 2);
  local.set("a", 3);

  const shared = new Context(new NextRequest(url()), {}, undefined, { shared: "ctx-shared-no-memory" });
  shared.set("c", 4);

  assert.equal(MEMORY_MAP.size, before);
});

/* ---------------------------------------------------------------------- */
/* 4. destroy() never leaves a value behind on the local branch, and is   */
/*    a no-op on the shared branch.                                      */
/* ---------------------------------------------------------------------- */

test("destroy() removes every key from a local Context's own values, including one holding undefined", () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("a", 1);
  ctx.set("b", 2);
  ctx.set("c", undefined);

  ctx.destroy();

  assert.deepEqual(ctx.values.local, {}, "reading the object directly, not through get(), so a cleared key can't hide behind an unset one");
});

test("calling destroy() twice in a row on a local Context does not throw", () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("a", 1);
  ctx.destroy();
  assert.doesNotThrow(() => ctx.destroy());
});

test("set() after destroy() on a local Context is written and read normally — destroy clears, it does not close", () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("a", 1);
  ctx.destroy();
  ctx.set("a", "again");
  assert.equal(ctx.get("a"), "again");
});

/* 0022 update: same reason as the roundtrip test above — check the value is
   still there via Object.values, not the literal (and still-moving) key name. */
test("destroy() on a shared-branch Context does nothing: RequestStore.peek still sees the value afterward", () => {
  const id = "ctx-shared-destroy-noop";
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
  ctx.set("k", "v");

  assert.doesNotThrow(() => ctx.destroy());
  assert.deepEqual(Object.values(RequestStore.peek(id)), ["v"], "a route already claimed the shared entry by the time destroy() runs — destroy has nothing of its own to clear there");
});

/* ---------------------------------------------------------------------- */
/* 5. The constructor never forwards the client's x-ecosyrequest-id.      */
/* ---------------------------------------------------------------------- */

test("the constructor deletes the client's x-ecosyrequest-id from init headers on a local Context", () => {
  const req = new NextRequest(url(), { headers: { [REQUEST_ID]: "client-sent" } });
  const ctx = new Context(req, {});
  assert.equal(ctx.init.request.headers.has(REQUEST_ID), false);
});

test("the constructor leaves init headers without x-ecosyrequest-id on a local Context when the client sent none", () => {
  const req = new NextRequest(url());
  const ctx = new Context(req, {});
  assert.equal(ctx.init.request.headers.has(REQUEST_ID), false);
});

test("the constructor sets init headers' x-ecosyrequest-id to the shared value, ignoring whatever the client sent", () => {
  const req = new NextRequest(url(), { headers: { [REQUEST_ID]: "client-sent-something-else" } });
  const ctx = new Context(req, {}, undefined, { shared: "server-issued-id" });
  assert.equal(ctx.init.request.headers.get(REQUEST_ID), "server-issued-id");
});

test("the constructor strips the client's request id header however its name is cased", () => {
  const req = new NextRequest(url(), { headers: { "X-ECOSYREQUEST-ID": "client-sent" } });
  const ctx = new Context(req, {});
  assert.equal(ctx.init.request.headers.has(REQUEST_ID), false);
  assert.equal(ctx.init.request.headers.has("X-ECOSYREQUEST-ID"), false);
});

/* ---------------------------------------------------------------------- */
/* 6. setHeader never touches this.req.headers.                          */
/* ---------------------------------------------------------------------- */

test("setHeader adds to init.request.headers without touching this.req.headers", () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.setHeader("x-a", "1");

  assert.equal(ctx.req.headers.has("x-a"), false);
  assert.equal(ctx.init.request.headers.get("x-a"), "1");
});

test("setHeader overriding a header the client sent keeps req.headers at the client's value while init gets the new one", () => {
  const req = new NextRequest(url(), { headers: { "x-b": "old" } });
  const ctx = new Context(req, {});
  ctx.setHeader("x-b", "new");

  assert.equal(ctx.req.headers.get("x-b"), "old");
  assert.equal(ctx.init.request.headers.get("x-b"), "new");
});

/* ---------------------------------------------------------------------- */
/* 0039 mục 1: init.request.headers is a COPY of every header the client  */
/* sent, including the ones Context never touches — not a bag that starts */
/* empty and only ever holds what setHeader() or the constructor itself   */
/* wrote into it.                                                         */
/*                                                                         */
/* Why the two existing setHeader tests above (section 6) don't already   */
/* cover this: both only read back the exact header they just set, so a  */
/* copy that starts as `new Headers()` (nothing carried over) satisfies    */
/* them just as well as a real copy would. Neither ever asks "the header  */
/* I did NOT touch — is it still there". That question is the one the QA  */
/* mutation `new Headers(req.headers)` → `new Headers()` survived through  */
/* all 59 tests by never being asked.                                     */
/*                                                                         */
/* The first pass at this test (this commit, before QA's second look)     */
/* asserted only the four names in CLIENT_HEADERS below, and its own name  */
/* still promised "every client header" — a whitelist-forward mutant,     */
/* a name-length-≤14 mutant, and a drop-empty-value mutant all satisfy     */
/* four fixed names just as well as a real copy, and none of them is a    */
/* strawman: "only forward the headers on an allow-list" is a plausible    */
/* real rewrite of this constructor line, and it is exactly the one that   */
/* would silently drop x-forwarded-for, user-agent, if-none-match and      */
/* accept-encoding — surface 0024/0025 are about to stand on. Fixed by     */
/* asserting against req.headers itself (below) instead of against a      */
/* fixed guest list, so the promise in the test's name and the promise     */
/* its body checks are the same axis, not three separate points on it.    */
/*                                                                         */
/* Headers measured (not assumed) to survive unchanged into `req.headers` */
/* on a NextRequest built with `new NextRequest(url, { headers })`: all   */
/* 21 tried, including the nine names this task's earlier draft assumed   */
/* undici's Headers would filter as hop-by-hop (connection,               */
/* transfer-encoding, keep-alive, host, content-length, te, upgrade,      */
/* expect, proxy-authorization) — none were filtered, and a header sent   */
/* with an empty string value keeps that exact empty string, not          */
/* undefined or a dropped entry. Full list measured: cookie, authorization,*/
/* content-type, x-client-trace, x-forwarded-for, user-agent,             */
/* if-none-match, accept-encoding, connection, transfer-encoding,         */
/* keep-alive, host, content-length, te, upgrade, expect,                 */
/* proxy-authorization, origin, referer, x-csrf-token, and one header      */
/* sent with value "". That is also why the loop below needs no exclusion  */
/* list beyond REQUEST_ID: nothing NextRequest hands to `req.headers` is   */
/* invisible to it.                                                       */
/* ---------------------------------------------------------------------- */

/* Measured (see the block above), not guessed: widened past the original four
   names on purpose. A whitelist-forward rewrite whose allow-list happens to be
   exactly {cookie, authorization, content-type, x-client-trace} — the four
   names this file already used — satisfies a loop over req.headers exactly as
   well as it satisfies a loop over this constant, because req.headers on a
   NextRequest never carries anything beyond what it's given: looping over
   req.headers only buys something when req.headers can hold a header the
   mutation's list does not expect. x-forwarded-for, user-agent, if-none-match
   and accept-encoding are the four the task names as the ones a plausible
   "known application headers" allow-list would drop — added here for exactly
   that reason, not as unrelated extra coverage. x-empty-value is here for a
   different mutation on the same line: "copy every header except one whose
   value is empty" — satisfied by every other entry above, none of which is
   empty, so it needs one that actually is.

   0039 round 3 adds origin, referer and x-csrf-token — QA's third
   nine-name-preserving mutant deletes exactly these three after copying
   everything else. Sending them here makes a fix that special-cases them
   away observable through the SAME loop as everything else, below.

   Written down where 0024/0025 will read it, because it is the honest
   limit of what this file can prove: this only catches a header being
   DROPPED after the client sent it. It cannot catch a header being
   dropped that the client's request never carried in the first place —
   there is nothing here to observe a header's absence against, since an
   absent header and a correctly-copied absent header look identical. That
   gap is a POINT, not an axis this loop closes; cookieJar (0024) and csrf
   (0025) should not read "origin/referer/x-csrf-token are in this list" as
   "this file proves they always arrive intact under every client request
   shape" — it proves only that THIS constructed request's copies of them
   survive. */
const CLIENT_HEADERS = {
  cookie: "sid=abc123",
  authorization: "Bearer tok-xyz",
  "content-type": "application/json",
  "x-client-trace": "trace-1",
  "x-forwarded-for": "203.0.113.5",
  "user-agent": "test-agent/1.0",
  "if-none-match": '"etag-1"',
  "accept-encoding": "gzip",
  "x-empty-value": "",
  origin: "https://example.com",
  referer: "https://example.com/from",
  "x-csrf-token": "csrf-tok-1",
};

/* Returns req.headers as a name-sorted array of [name, value] pairs, minus
   REQUEST_ID — REQUEST_ID is the one header Context DOES touch (it strips
   it), which is a separate, already-covered promise (section 5 above), not
   something this comparison should renegotiate. Sorting makes the compare
   below order-independent; Headers' own iteration order is already stable
   and alphabetic, but sorting explicitly means this never depends on that
   implementation detail either. */
function clientHeaderEntriesExcludingRequestId(headers) {
  return [...headers].filter(([name]) => name !== REQUEST_ID).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

test("init.request.headers on a local Context is EXACTLY req.headers minus x-ecosyrequest-id — a two-way equality, not a one-way inclusion check", () => {
  const req = new NextRequest(url(), { headers: CLIENT_HEADERS });
  const ctx = new Context(req, {});

  /* 0039 round 3 mục 2a: the loop this replaced only ever asked "for every
     header req.headers has, is it also in init.request.headers" — a
     one-directional inclusion check. It cannot see a header init.request
     .headers has that req.headers does NOT: a fix that copies everything
     correctly and then, say, ADDS its own extra header (x-ecosy-injected:
     1) passes a one-way check just as well as a correct copy does. Full
     set equality on both sides closes that: an invented header shows up on
     the "actual" side with nothing to match it on "expected", and
     assert.deepEqual on the two sorted arrays fails immediately. */
  const expected = clientHeaderEntriesExcludingRequestId(req.headers);
  const actual = clientHeaderEntriesExcludingRequestId(ctx.init.request.headers);
  assert.deepEqual(actual, expected, "ctx.init.request.headers must hold exactly the client's headers minus x-ecosyrequest-id — nothing dropped, nothing added");
});

test("init.request.headers on a shared Context is EXACTLY req.headers minus x-ecosyrequest-id, AND separately sets x-ecosyrequest-id to the server-issued id — two independent things, checked separately so neither assertion can hide behind the other", () => {
  const req = new NextRequest(url(), { headers: CLIENT_HEADERS });
  const ctx = new Context(req, {}, undefined, { shared: "ctx-headers-shared-copy" });

  // (1) the client headers survived the copy, exactly — same two-way equality as the local-branch test above.
  const expected = clientHeaderEntriesExcludingRequestId(req.headers);
  const actual = clientHeaderEntriesExcludingRequestId(ctx.init.request.headers);
  assert.deepEqual(actual, expected, "ctx.init.request.headers must hold exactly the client's headers minus x-ecosyrequest-id on the shared branch too");

  // (2) the request id is the one the server issued, not left unset by the copy above.
  assert.equal(ctx.init.request.headers.get(REQUEST_ID), "ctx-headers-shared-copy");
});

/* 0039 round 3 mục 2b: every name above is a compile-time constant, so a
   mutant could — in principle, if someone were determined enough — special-
   case exactly this file's names and still pass.

   Reviewer correction (0039 round 6 review): the sentence that used to stand
   here claimed the table below closes that off "structurally, because its
   names are generated while the test is RUNNING". That is true of exactly
   TWO of its seven rows — the two built from randomUUID(). The other five
   (`x-token99a`, `x_t`, `x.t`, `x-a1`, `X-UPPER-DYNAMIC`) are literal
   constants sitting right here in the file, which is precisely the thing the
   old sentence said this table was immune to. The rows are still worth
   having — `x_t` and `x.t` are axes no generator in this file produces — but
   they are chosen names, not unguessable ones, and the test's own name now
   says so. The claim "no list written in advance could have matched this"
   is carried for the whole axis, deterministically and at scale, by the
   1024-header test further down, not by this table.

   Table below, one axis different per row from an ordinary lowercase ASCII
   token name — the axes are the ones the round asked for by name, not
   invented here: length past any reasonable boundary, digits in the name,
   three flavors of "valid HTTP token character but rare in practice"
   (underscore, dot, digit right after a dash), the name sent upper-case,
   and an empty value. `x_t`, `x.t` and `x-a1` are named directly in the
   round's own instructions, not picked by this file — token grammar
   (RFC 7230 §3.2.6) allows all three; a whitelist regex like /^[a-z-]+$/
   (one of QA's five nine-name-preserving mutants) rejects every one of
   them. The upper-case row is weaker by construction: Headers itself
   lower-cases every name on both set and get (that's the Fetch spec, not
   this code), so `.get("X-...")` and `.get("x-...")` are indistinguishable
   to any caller including this test — it can only prove the copy path does
   not do something case-sensitive of its own on top of what Headers
   already normalizes; it cannot prove anything about wire-level casing. */
const DYNAMIC_HEADER_CASES = [
  { axis: "length far past any static boundary", name: `x-${randomUUID()}`, value: "v-length" },
  { axis: "digits in the name", name: "x-token99a", value: "v-digits" },
  { axis: "rare-but-valid token char: underscore", name: "x_t", value: "v-underscore" },
  { axis: "rare-but-valid token char: dot", name: "x.t", value: "v-dot" },
  { axis: "rare-but-valid token char: digit right after a dash", name: "x-a1", value: "v-dash-digit" },
  { axis: "name sent upper-case", name: "X-UPPER-DYNAMIC", value: "v-upper" },
  { axis: "empty value", name: `x-${randomUUID()}`, value: "" },
];

test("a table of header names, one axis different per row (length, digits, underscore, dot, digit-after-dash, upper-case, empty value), all survive the copy — five rows are fixed names picked for their axis, two are generated at runtime", () => {
  const headers = Object.fromEntries(DYNAMIC_HEADER_CASES.map(({ name, value }) => [name, value]));
  const req = new NextRequest(url(), { headers });
  const ctx = new Context(req, {});

  for (const { axis, name, value } of DYNAMIC_HEADER_CASES) {
    assert.equal(ctx.init.request.headers.get(name), value, `axis "${axis}" (header ${JSON.stringify(name)}) did not survive the copy`);
  }
});

/* 0039 round 4 mục 4: QA widened instead of narrowing, and found a wall
   neither CLIENT_HEADERS (12 headers, 273 bytes of name+value) nor
   DYNAMIC_HEADER_CASES (7 rows) was big enough to see. Three mutants
   survived every test above:
     - copy only the first 12 headers (in whatever order the copy iterates)
     - copy every header except the one at index 12
     - stop copying once the running total of name+value bytes passes 273
   None of those three numbers is a coincidence — 12 and 273 are exactly
   CLIENT_HEADERS' own size. A fixture that happens to be exactly as big as
   a plausible mutant's hardcoded threshold cannot tell a correct,
   unbounded copy apart from one secretly bounded at that same threshold;
   the two produce an identical result on that one fixture, by construction.
   "only forward headers on an allow-list" is 0039 round 1's example of a
   plausible real rewrite that isn't a strawman — a positional or byte-
   length ceiling is the same kind of plausible rewrite on the other axis
   (someone bounding how much of a request's headers get forwarded, out of
   a concern for header-bomb-style abuse), not a strawman either.

   Round 4 fixed this by widening the fixture to a FIXED 45. That is the
   same mistake as writing a static header NAME before the copy this file
   tests even runs, just on a different axis: QA proved it at round 5 by
   planting FOUR mutants at and around exactly 45 — copy the first 45 of
   whatever order the copy iterates, drop precisely index 45, cap the
   running byte total at 3850 (the real total of that exact 45-header
   request), and copy the first 46 — every one of the four survived this
   test, and every one of the four then dropped any header sent at
   position 46-60.

   Round 5 answered that by drawing the count at random each run, range
   40-64. QA (round 6) rejected that too, with a counting argument, not a
   style objection: a wall at some fixed N ≤ 63 is killed by the random
   draw only on the runs that happen to land above N — for N=60 that was
   measured at 1/12 runs, for N=50 at 5/12 — while a single fixed size of
   1024 kills every wall N < 1024 on EVERY run, with probability 1.0,
   because this file always builds exactly 1024 headers, never fewer. The
   kill set of "draw randomly in [40,64]" is a SUBSET of the kill set of
   "always build 1024": nothing the random draw could ever catch is
   outside what 1024 already catches outright, so the randomness bought no
   additional dead mutants — it only sold away determinism. And a
   probabilistic red is worse than a flaky one for a different reason: the
   normal reader reaction to a red CI run is "run it again", and running it
   again is exactly what makes a probabilistic catch disappear — a false
   acquittal for a real regression, not a false alarm for a fake one.

   So: no draw, no range, one large fixed constant. 1024 is not tuned to
   any observed mutant's threshold the way 45 was tuned to CLIENT_HEADERS'
   own size — it is simply large enough that no plausible hardcoded wall
   ("copy the first N", "drop index N", "cap total bytes") sits above it by
   accident, and QA measured n = 64/256/512/1024/4096 all build and copy
   through a real Context instantly, so there is no cost to picking a
   number this large over a smaller one.

   Known, measured limit of this approach, not fixed and not silent: a
   wall placed AT OR ABOVE 1024 itself (e.g. "copy/keep only the first 1024
   headers") is truly equivalent, not a gap anyone missed — this file
   always builds exactly 1024, so a cap AT 1024 never truncates anything,
   the same way no single fixed count ever fully closes this axis. Picking
   a bigger constant shrinks the set of walls this misses but never closes
   it to zero. */
const RUNTIME_HEADER_COUNT = 1024;

/** Builds `count` headers with names and values generated while this
 *  function is RUNNING — nothing written before this call could have
 *  hardcoded any of them. */
function buildManyRuntimeHeaders(count) {
  const headers = {};
  for (let i = 0; i < count; i++) {
    headers[`x-gen-${i}-${randomUUID()}`] = `v-${i}-${randomUUID()}`;
  }
  return headers;
}

test(`a request carrying ${RUNTIME_HEADER_COUNT} headers survives the copy header-for-header — every hardcoded wall below 1024 dies here, deterministically, on every single run, not just probabilistically on some of them`, () => {
  const headers = buildManyRuntimeHeaders(RUNTIME_HEADER_COUNT);
  const req = new NextRequest(url(), { headers });
  const ctx = new Context(req, {});

  const expected = clientHeaderEntriesExcludingRequestId(req.headers);
  assert.equal(expected.length, RUNTIME_HEADER_COUNT, "sanity: NextRequest itself kept every one of the generated headers");

  const actual = clientHeaderEntriesExcludingRequestId(ctx.init.request.headers);
  assert.deepEqual(actual, expected, `all ${RUNTIME_HEADER_COUNT} runtime-generated headers must survive the copy — nothing dropped, nothing added, regardless of position or total byte length`);
});

/* Corrected, 0039 round 3: the previous version of this comment claimed
   `new Headers(req.headers)` vs. a manual
   `new Headers(); req.headers.forEach((v, k) => headers.set(k, v))` copy
   were equivalent, on the theory that `set-cookie` — the one header name
   `Headers` refuses to comma-join — "is a response header, never a
   request one". That premise is WRONG, and it was checkable in eight
   lines without any theorizing: `NextRequest` accepts `set-cookie` on a
   REQUEST just fine, and undici's `Headers` keeps duplicate `set-cookie`
   entries separate regardless of which side of the wire they are on — see
   the measured example above the test below. "set-cookie only shows up on
   responses" is a fact about HTTP convention, not a rule either `Context`
   or `NextRequest` enforces, so it was never a mechanical impossibility —
   just an assumption nobody had measured. Left as a dead mutant this way,
   it would have been WORSE than an ordinary surviving one: a surviving
   mutant is a known gap; a mutant wrongly written up as impossible is a
   gap that whoever next edits context.ts:172-ish (0024's cookieJar is
   scheduled to stand exactly there) would trust and not re-check. Fixed by
   writing the test QA's counter-example asks for, below, instead of by
   rewording the old claim into something narrower — a test in the suite
   is the only form of "closed" that survives a future edit to this file.

   The other mutant this comment used to bundle in — `RequestStore.claim`
   (src/request-store.ts) returning `{ ...entry.values }` instead of
   `entry.values` directly — is still not worth patching, but for a
   narrower reason than originally written. See the corrected note beside
   `claim` in request-store.test.mjs; the same correction applies there. */

test("a request carrying set-cookie twice keeps BOTH values through the Headers-constructor copy — getSetCookie() never folds them into one, unlike every other header name", () => {
  /* Measured directly on NextRequest, not assumed: undici's Headers treats
     set-cookie as the one name it never comma-joins, on either a request
     or a response — getSetCookie() below is the API the fetch spec adds
     specifically to read all of them back separately. x-dup is here as a
     control: an ORDINARY repeated header name IS comma-joined by the time
     it reaches req.headers, which is exactly why a manual forEach+set copy
     (which only ever sees one already-joined entry per ordinary name) and
     the Headers-constructor copy cannot be told apart through anything
     other than set-cookie. */
  const req = new NextRequest(url(), {
    headers: [
      ["set-cookie", "a=1"],
      ["set-cookie", "b=2"],
      ["x-dup", "p, q"],
    ],
  });

  const ctx = new Context(req, {});
  assert.deepEqual(
    ctx.init.request.headers.getSetCookie(),
    ["a=1", "b=2"],
    "both set-cookie values sent on the request must survive the copy — a forEach+set copy loses the first one, keeping only the last",
  );

  /* The control, actually checked (it never was, before 0039 round 4): an
     ordinary repeated header name is ALREADY comma-joined into one entry
     by the time it reaches req.headers, so both a forEach+set copy and the
     Headers-constructor copy see the same single, already-joined value and
     cannot disagree on it. Without this assertion "control" was just a word
     next to a header nothing in the test ever read. */
  assert.equal(
    req.headers.get("x-dup"),
    "p, q",
    "sanity: an ordinary repeated header name must already be comma-joined by req.headers itself, or it is not the control this test claims it is",
  );
  assert.equal(
    ctx.init.request.headers.get("x-dup"),
    "p, q",
    "the already-joined x-dup value must survive the copy unchanged, same as any other ordinary header",
  );
});

test("init.request.headers is a copy of req.headers, not the same object — an alias would satisfy every get() above without ever copying anything", () => {
  const ctx = new Context(new NextRequest(url(), { headers: CLIENT_HEADERS }), {});
  assert.notStrictEqual(ctx.init.request.headers, ctx.req.headers);
});

test("a header Context DOES touch — x-ecosyrequest-id sent by the client — is still stripped on a local Context even once the copy fix is in place; the old promise is not loosened by the new one", () => {
  const req = new NextRequest(url(), { headers: { ...CLIENT_HEADERS, [REQUEST_ID]: "client-sent" } });
  const ctx = new Context(req, {});

  assert.equal(ctx.init.request.headers.has(REQUEST_ID), false);
  // and the rest of the copy still holds, so a fix that special-cased
  // REQUEST_ID by wiping the whole Headers object (rather than deleting
  // just this one key) would pass the assertion above and fail this one.
  assert.equal(ctx.init.request.headers.get("cookie"), CLIENT_HEADERS.cookie);
});

/* ---------------------------------------------------------------------- */
/* Coverage gaps named in 0021 that are not "must not" hunts: uri,        */
/* baseUrl, env.                                                         */
/* ---------------------------------------------------------------------- */

test("baseUrl returns the incoming request's origin", () => {
  const ctx = new Context(new NextRequest("http://localhost:3000/api/x?y=1"), {});
  assert.equal(ctx.baseUrl, "http://localhost:3000");
});

/* 0039 mục 2: renamed from "uri builds an absolute URL on baseUrl, with
   path and query from its options". That name promised the base was
   `baseUrl` specifically, but the request it ran on carried no query of
   its own — so `base = this.baseUrl` (origin) and `base = this.url.href`
   (full URL) produce the exact same string here, and the test could not
   tell them apart. What this body actually proves is narrower: createUrl
   correctly renders a pathname and a search object onto an absolute URL.
   The two tests below are the ones that pin the origin-vs-href question. */
test("uri renders pathname and a search object into an absolute URL, on a request whose own URL carries no query to leak", () => {
  const ctx = new Context(new NextRequest("http://localhost:3000/api/x"), {});
  assert.equal(ctx.uri({ pathname: "/foo", search: { a: 1 } }), "http://localhost:3000/foo?a=1");
});

test("uri({ pathname }) without a search option builds strictly on the origin — none of the request's own query string leaks through — dies on base: this.url.href replacing base: this.baseUrl", () => {
  const ctx = new Context(new NextRequest("http://localhost:3000/api/x?leak=1"), {});
  assert.equal(ctx.uri({ pathname: "/foo" }), "http://localhost:3000/foo");
});

/* 0039 mục 2 (round 2): a URL is wider than an origin in three parts, not
   two. pathname and search are pinned by the two tests above; the third —
   hash — was still open, and a request's own fragment survives all the way
   into `this.url` (measured: `new URL(req.url).hash === "#frag"` on a
   NextRequest built from a URL carrying one) exactly like its query string
   does. The mutation this closes lives in `baseUrl` itself, not in `uri`:
   `get baseUrl() { return this.url.origin; }` → `return this.url.origin +
   this.url.hash;` survived every test above, because none of them ran on a
   request that had a fragment to leak. */
test("uri() with no arguments returns exactly the origin (with its trailing slash) — neither the request's own path, query string, nor fragment is carried over", () => {
  const ctx = new Context(new NextRequest("http://localhost:3000/api/x?leak=1#frag"), {});
  assert.equal(ctx.uri(), "http://localhost:3000/");
});

test("env returns process.env by reference, not a copy", () => {
  const ctx = new Context(new NextRequest(url()), {});
  assert.strictEqual(ctx.env, process.env);
});

/* ---------------------------------------------------------------------- */
/* 9. 0022: a key adjacent to the prototype is stored and read back as    */
/*    its own key — never leaking into another key, and never reaching   */
/*    Object.prototype. The fix is Context prefixing every key with "$"  */
/*    before it reaches either branch's plain object.                    */
/* ---------------------------------------------------------------------- */

const PROTOTYPE_ADJACENT_NAMES = [
  "__proto__", "constructor", "prototype", "toString", "valueOf",
  "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "toLocaleString", "__defineGetter__", "__lookupGetter__",
];

/**
 * The three assertions 0022 asks for, on one context: setting `name` never
 * shows up under an unrelated key, the key itself round-trips to the exact
 * object it was given, and no unrelated object anywhere in the process
 * picked up the value through Object.prototype.
 */
function assertNameIsJustAKey(ctx, name) {
  const poison = { isAdmin: true };
  ctx.set(name, poison);

  assert.equal(ctx.get("isAdmin"), undefined, `${JSON.stringify(name)} leaked into an unrelated "isAdmin" key`);
  assert.strictEqual(ctx.get(name), poison, `${JSON.stringify(name)} did not round-trip to the exact object set`);
  assert.equal(({}).isAdmin, undefined, `${JSON.stringify(name)} polluted Object.prototype for every other object`);
}

test("every prototype-adjacent key name round-trips as its own key on a local Context, none of them leaking into another key or reaching Object.prototype", () => {
  for (const name of PROTOTYPE_ADJACENT_NAMES) {
    const ctx = new Context(new NextRequest(url()), {});
    assertNameIsJustAKey(ctx, name);
  }
});

test("every prototype-adjacent key name round-trips as its own key on a shared Context backed by RequestStore, none of them leaking into another key or reaching Object.prototype", () => {
  for (const name of PROTOTYPE_ADJACENT_NAMES) {
    const id = `ctx-proto-shared-${name}`;
    const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
    assertNameIsJustAKey(ctx, name);
  }
});

test('a primitive value stored under the key "__proto__" round-trips exactly on a local Context — the case a fix that only special-cases object values would still swallow', () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("__proto__", "xin chào");
  assert.equal(ctx.get("__proto__"), "xin chào");
});

test('a primitive value stored under the key "__proto__" round-trips exactly on a shared Context — the case a fix that only special-cases object values would still swallow', () => {
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: "ctx-proto-primitive-shared" });
  ctx.set("__proto__", "xin chào");
  assert.equal(ctx.get("__proto__"), "xin chào");
});

/* ---------------------------------------------------------------------- */
/* 10. 0022: the "$" prefix never makes two different keys land in the    */
/*     same place, on either branch.                                     */
/* ---------------------------------------------------------------------- */

test('set("$a", 1) and set("a", 2) on the same local Context are two different keys, each reading back its own value', () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("$a", 1);
  ctx.set("a", 2);
  assert.equal(ctx.get("$a"), 1);
  assert.equal(ctx.get("a"), 2);

  /* Same axis, different character: nothing in the "$" prefix says a key is
     trimmed before it is prefixed. A key that only differs from another by
     leading whitespace must stay a different key — set(" a") and set("a")
     landing in the same place would be exactly the kind of collision this
     test's own name promises can't happen, just triggered by whitespace
     instead of by "$". */
  ctx.set(" a", "space-a");
  ctx.set("a", "bare-a-again");
  assert.equal(ctx.get(" a"), "space-a");
  assert.equal(ctx.get("a"), "bare-a-again");
});

test('set("$__proto__", value) is an ordinary key distinct from the dangerous "__proto__" name, and round-trips by reference', () => {
  const ctx = new Context(new NextRequest(url()), {});
  const value = { ok: true };
  const other = { ok: false };
  ctx.set("$__proto__", value);
  /* The name promises "$__proto__" is distinguishable FROM the dangerous
     "__proto__" — that promise is only checked by also setting "__proto__" on
     the very same context and reading both back. Without this, the test only
     ever wrote "$__proto__" and never gave "__proto__" a chance to collide
     with it, which is a narrower claim than the test's own name. */
  ctx.set("__proto__", other);
  assert.strictEqual(ctx.get("$__proto__"), value, '"$__proto__" did not keep its own value once "__proto__" was also set');
  assert.strictEqual(ctx.get("__proto__"), other, '"__proto__" did not keep its own value once "$__proto__" was also set');
});

test('set("", value) — the empty-string key — round-trips and does not collide with an unrelated key set on the same Context', () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("", "empty-key-value");
  ctx.set("other", "other-value");
  assert.equal(ctx.get(""), "empty-key-value");
  assert.equal(ctx.get("other"), "other-value");
});

test('set("$", v1) and set("", v2) on the same Context are two different keys', () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("$", "dollar-key-value");
  ctx.set("", "empty-key-value");
  assert.equal(ctx.get("$"), "dollar-key-value");
  assert.equal(ctx.get(""), "empty-key-value");
});

/* QA round 4 (R7): the test above pins exactly one point on this axis —
   leading ASCII space, on the local branch only. Its neighbors are still
   open: trailing whitespace (the mirror image, on either branch), leading
   OR trailing whitespace on set()'s *shared* branch (the block above only
   ever calls set() on a local Context), Unicode normalization folding two
   spellings of the same letter into one, a zero-width character silently
   dropped, or a run of whitespace *inside* a key collapsed to one space —
   all six are observable the same way ("$"-prefixing does not stop a key
   from being reshaped before it's stored) and none of them are caught by a
   test that only varies one axis at a time.

   The actual invariant underneath every one of those: the physical key a
   Context ever writes is EXACTLY "$" plus the caller's key, character for
   character — no trimming, no normalizing, no stripping, no collapsing, on
   either branch. One key carrying all six kinds of "invisible" difference
   at once proves that directly, by reading the raw bag ourselves instead of
   only asking get() to echo a value back — get() alone could theoretically
   apply the same reshaping on read as on write and still round-trip. */
const WEIRD_KEY =
  " a" +      // leading ASCII space
  " " +  // NBSP sitting between two ordinary letters
  "b" +
  "  " +      // two ASCII spaces in the middle of the key
  "c" +
  "​" +  // zero-width space
  "d " +
  "é" + // "é" held as NFD: a plain "e" plus a combining acute accent
  " ";        // trailing ASCII space

test('the physical key Context ever writes is exactly "$" plus the caller\'s key, character for character — not trimmed, not normalized, not collapsed', () => {
  const localCtx = new Context(new NextRequest(url()), {});
  localCtx.set(WEIRD_KEY, 1);
  assert.deepEqual(Object.keys(localCtx.values.local), ["$" + WEIRD_KEY], "the local bag's own key must be exactly \"$\" + WEIRD_KEY");
  assert.equal(localCtx.get(WEIRD_KEY), 1);

  const id = "ctx-weird-key-shared";
  const sharedCtx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
  sharedCtx.set(WEIRD_KEY, 1);
  assert.deepEqual(Object.keys(RequestStore.peek(id)), ["$" + WEIRD_KEY], "the key held in RequestStore must be exactly \"$\" + WEIRD_KEY");
  assert.equal(sharedCtx.get(WEIRD_KEY), 1);
});

/* R7-bis (QA round 5): WEIRD_KEY above proves the invariant on one key
   carrying six axes of "invisible difference" at once — but "at once" is
   exactly why it missed two orthogonal mutants QA found: key.slice(0, 64)
   and lowering only the first character. WEIRD_KEY is 12 characters and
   starts with whitespace, so a length cut at 64 never reaches its tail and
   a first-character lowercase flip never touches its leading space. A
   sample proving several axes bundled together only pins the axes that
   sample happens to carry; it says nothing about an axis the sample doesn't
   exercise. Per the house rule added for exactly this failure ("a universal
   claim needs a TABLE, not a sample"), this closes the whole class: one row
   per axis, each row a pair of keys differing in exactly one way — and for
   each pair, on both the local and the shared branch, the bag must hold two
   own keys, each physical key must be exactly "$" + that caller key, and
   each key must read back its own value, not its partner's. */
const KEY_PAIRS = [
  ["leading whitespace", " lead", "lead"],
  ["trailing whitespace", "trail ", "trail"],
  ["a run of whitespace in the middle collapsing to one space", "ab  cd", "ab cd"],
  ["NBSP vs an ordinary space in the same position", "nb sp", "nb sp"],
  ["NFD vs NFC of the same letter (é)", "éclair", "éclair"],
  ["a zero-width character present vs stripped", "zw​sp", "zwsp"],
  ["length differs only after the 64th character", "u".repeat(64) + "Alice", "u".repeat(64) + "Bob"],
  ["length differs only after the 128th character", "u".repeat(128) + "Alice", "u".repeat(128) + "Bob"],
  ["length differs only after the 255th character", "u".repeat(255) + "Alice", "u".repeat(255) + "Bob"],
  ["uppercase vs lowercase the FIRST character only", "UserId", "userId"],
  ["uppercase vs lowercase the WHOLE key", "ABC", "abc"],
];

test('for every pair of keys below, differing on exactly one axis (leading/trailing/middle whitespace, NBSP vs space, NFD vs NFC, zero-width, a length cut past 64/128/255 characters, first-character case, whole-key case), the bag holds two own keys, each physical key is exactly "$" plus that caller key, and each key reads back its own value — on both the local and the shared branch', () => {
  for (const [axis, keyA, keyB] of KEY_PAIRS) {
    const valueA = `${axis} :: A`;
    const valueB = `${axis} :: B`;

    const localCtx = new Context(new NextRequest(url()), {});
    localCtx.set(keyA, valueA);
    localCtx.set(keyB, valueB);
    assert.deepEqual(
      Object.keys(localCtx.values.local),
      ["$" + keyA, "$" + keyB],
      `[${axis}] (local) the bag must hold exactly two own keys, "$"+keyA and "$"+keyB`,
    );
    assert.equal(localCtx.get(keyA), valueA, `[${axis}] (local) keyA did not read back its own value`);
    assert.equal(localCtx.get(keyB), valueB, `[${axis}] (local) keyB did not read back its own value`);

    const id = `ctx-axis-pair-local-vs-shared-${axis}`;
    const sharedCtx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
    sharedCtx.set(keyA, valueA);
    sharedCtx.set(keyB, valueB);
    assert.deepEqual(
      Object.keys(RequestStore.peek(id)),
      ["$" + keyA, "$" + keyB],
      `[${axis}] (shared) RequestStore must hold exactly two own keys, "$"+keyA and "$"+keyB`,
    );
    assert.equal(sharedCtx.get(keyA), valueA, `[${axis}] (shared) keyA did not read back its own value`);
    assert.equal(sharedCtx.get(keyB), valueB, `[${axis}] (shared) keyB did not read back its own value`);
  }
});

/* ---------------------------------------------------------------------- */
/* 11. 0022: the "$" prefix is added at exactly one layer — Context — and */
/*     nowhere else. Proxy's set() and Route's get() run in separate      */
/*     module graphs (see request-id.test.mjs's own note on this), so    */
/*     this can only be checked by actually sending a value across that   */
/*     boundary in one process, not by building a Context by hand on     */
/*     both ends.                                                        */
/* ---------------------------------------------------------------------- */

const FORWARDED_PREFIX = "x-middleware-request-";
const payload = () => ({ params: Promise.resolve({}) });

/** The request headers a proxy response forwards, as Next reads them. */
function forwarded(response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name.startsWith(FORWARDED_PREFIX)) headers.set(name.slice(FORWARDED_PREFIX.length), value);
  }
  return headers;
}

test("a value a Proxy's middleware sets survives the handoff and is read back by a Route under the same key", async () => {
  const proxy = Proxy({}).use((ctx) => ctx.set("layerUserId", "u-layer-1"));
  const id = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(REQUEST_ID);

  const { GET } = Route().get((ctx) => ctx.get("layerUserId") ?? null);
  const res = await GET(new NextRequest(url(), { headers: { [REQUEST_ID]: id } }), payload());
  assert.equal((await res.json()).data, "u-layer-1");
});

test('a value a Proxy\'s middleware sets is held in RequestStore under the prefixed key "$layerUserId", never under the bare "layerUserId"', async () => {
  const proxy = Proxy({}).use((ctx) => ctx.set("layerUserId", "u-layer-2"));
  const id = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(REQUEST_ID);

  const stored = RequestStore.peek(id);
  assert.equal(stored["$layerUserId"], "u-layer-2", "the prefixed key is missing — Context did not add the prefix before handing off to RequestStore");
  assert.equal("layerUserId" in stored, false, "the bare key is present — either Context never prefixed it, or something re-added it unprefixed downstream");
});

/* ---------------------------------------------------------------------- */
/* 12. 0022: destroy() removes a key that arrived under "__proto__", not  */
/*     just keys that arrived under an ordinary name — the second bug     */
/*     the same fix closes, since Object.keys never used to see it.      */
/* ---------------------------------------------------------------------- */

test('destroy() removes the key that "__proto__" landed under, and Object.keys of the bag is empty afterward', () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("__proto__", { a: 1 });

  ctx.destroy();

  assert.equal(ctx.get("a"), undefined);
  assert.equal(ctx.get("__proto__"), undefined);
  assert.deepEqual(Object.keys(ctx.values.local), []);
});

test('destroy() clears a "__proto__" key mixed with ordinary keys, leaving none of the three behind', () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.set("x", 1);
  ctx.set("__proto__", { y: 2 });
  ctx.set("z", 3);

  ctx.destroy();

  assert.equal(ctx.get("x"), undefined);
  assert.equal(ctx.get("__proto__"), undefined);
  assert.equal(ctx.get("z"), undefined);
  assert.deepEqual(Object.keys(ctx.values.local), []);
});

/* ---------------------------------------------------------------------- */
/* 13. 0022: a poisoned "__proto__" a Proxy hands to a Route never        */
/*     reaches the Route's read of an unrelated key — the same chain with */
/*     a real key does carry the value, so the check above is not        */
/*     vacuous.                                                           */
/* ---------------------------------------------------------------------- */

test('a Proxy\'s __proto__ poisoning never reaches a Route\'s read of "role", while the same chain with a real "role" value does — so the check is not vacuous', async () => {
  const poisoned = Proxy({}).use((ctx) => ctx.set("__proto__", { role: "root" }));
  const poisonedId = forwarded(await poisoned(new NextRequest(url("/page")), payload())).get(REQUEST_ID);

  const { GET } = Route().get((ctx) => ctx.get("role") ?? null);
  const poisonedRes = await GET(new NextRequest(url(), { headers: { [REQUEST_ID]: poisonedId } }), payload());
  assert.equal((await poisonedRes.json()).data, null, "the Route read a role from a Proxy that never set one");

  const real = Proxy({}).use((ctx) => ctx.set("role", "root"));
  const realId = forwarded(await real(new NextRequest(url("/page")), payload())).get(REQUEST_ID);
  const realRes = await GET(new NextRequest(url(), { headers: { [REQUEST_ID]: realId } }), payload());
  assert.equal((await realRes.json()).data, "root", "a real 'role' value did not survive the same chain — the check above would have been vacuous");
});

/* ---------------------------------------------------------------------- */
/* 14. QA R1: get()'s `values?.[KEY_PREFIX + key]` optional chaining is    */
/*     the only thing standing between a shared Context's read and a      */
/*     TypeError, on the two ways RequestStore.peek() answers undefined:  */
/*     no entry was ever written under this id, or one was written and    */
/*     its 60s TTL has since passed. Both are ordinary, not exotic — a    */
/*     middleware doing `if (ctx.get("userId")) ...` before any ctx.set   */
/*     hits the first one on every request. Dropping the `?.` survived    */
/*     73/73 before these two tests existed, because nothing in this      */
/*     suite ever read from a shared Context with an empty or expired     */
/*     store — every other shared-branch test writes before it reads.    */
/* ---------------------------------------------------------------------- */

test("get() on a shared Context that never had anything written under its id returns undefined instead of throwing", () => {
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: "ctx-shared-no-entry-ever" });
  assert.doesNotThrow(
    () => ctx.get("userId"),
    "RequestStore.peek() answers undefined for an id nobody wrote to yet — get() must not assume it always gets an object back",
  );
  assert.equal(ctx.get("userId"), undefined);
});

test("get() on a shared Context whose entry has passed its 60s TTL returns undefined instead of throwing", () => {
  const id = "ctx-shared-ttl-expired-via-get";
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
  ctx.set("userId", "u1");

  const real = Date.now;
  Date.now = () => real() + 61_000;
  try {
    assert.doesNotThrow(
      () => ctx.get("userId"),
      "RequestStore.peek() answers undefined once the entry's TTL has passed — get() must not assume the entry it wrote earlier is still there",
    );
    assert.equal(ctx.get("userId"), undefined);
  } finally {
    Date.now = real;
  }
});

/* ---------------------------------------------------------------------- */
/* 15. QA round 6: the 11-row table above closes 11 POINTS on the length/  */
/*     normalization axis, not the axis. Its sharpest edge — a length cut */
/*     dies at slice(0,259), survives at slice(0,260), because 260 is the */
/*     longest key any row uses. A property test with a fixed seed closes */
/*     the axis instead of adding a 12th point: 200 random keys and 200   */
/*     random one-position-different pairs, up to 1500 characters, drawn  */
/*     from an alphabet spanning every class the task names. Fixed seed   */
/*     so a red run here reproduces exactly, the same reason WEIRD_KEY's  */
/*     assertions read Object.keys() directly instead of trusting get().  */
/* ---------------------------------------------------------------------- */

const SEED = 0x0022_0006; // fixed on purpose — do not reseed; a red run must reproduce byte-for-byte

/** mulberry32 — small, dependency-free, deterministic for a given seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* One "atom" per character class the task lists. An atom is a whole JS
   string, not a code point, so an outside-the-BMP emoji (a surrogate pair)
   moves as one unit and a "position" below means an atom index, never a
   half-surrogate. */
const ATOMS = [
  ..."abcXYZ0129".split(""),               // plain ASCII letters and digits
  ..."!@#%&*()-_.,;:".split(""),            // punctuation
  " ", " ", "　", "\t",            // 4 whitespace kinds: space, NBSP, CJK ideographic space, tab
  "​", "‍", "﻿", "­",   // ZWSP, ZWJ, BOM, soft hyphen
  "́", "̧",                       // combining acute, combining cedilla
  "ﬁ",                                 // "ﬁ" ligature
  "Ａ", "ａ", "０",             // fullwidth "A", "a", "0"
  "İ", "ı",                       // İ, ı
  "中", "文", "字",             // CJK: 中 文 字
  "\u{1F600}", "\u{1F389}",                 // emoji outside the BMP (surrogate pairs)
];

/** A random atom sequence, its string length capped near `maxLen` (may run
 *  one atom over, since a multi-code-unit atom can cross the cap). */
function randomAtoms(rng, maxLen) {
  const target = 1 + Math.floor(rng() * maxLen);
  const atoms = [];
  for (let len = 0; len < target; ) {
    const atom = ATOMS[Math.floor(rng() * ATOMS.length)];
    atoms.push(atom);
    len += atom.length;
  }
  return atoms;
}

test('for each of 200 seeded random keys, up to 1500 characters, drawn from an alphabet spanning every class the task lists, the bag holds exactly one own key equal to "$" plus that key, and it reads back its own value — on both branches', () => {
  const rng = mulberry32(SEED);
  for (let i = 0; i < 200; i++) {
    const key = randomAtoms(rng, 1500).join("");
    const value = { sample: i };

    const localCtx = new Context(new NextRequest(url()), {});
    localCtx.set(key, value);
    assert.deepEqual(Object.keys(localCtx.values.local), ["$" + key], `sample #${i} (local) — key of length ${key.length}`);
    assert.equal(localCtx.get(key), value, `sample #${i} (local) did not read back its own value`);

    const id = `ctx-prop-key-${i}`;
    const sharedCtx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
    sharedCtx.set(key, value);
    assert.deepEqual(Object.keys(RequestStore.peek(id)), ["$" + key], `sample #${i} (shared) — key of length ${key.length}`);
    assert.equal(sharedCtx.get(key), value, `sample #${i} (shared) did not read back its own value`);
  }
});

test('for each of 200 seeded random key pairs, differing at exactly one random position, up to 1500 characters long, the bag holds exactly two own keys, each physical key is exactly "$" plus that caller key, and each key reads back its own value, not its partner\'s — on both branches', () => {
  const rng = mulberry32(SEED ^ 0x9e3779b9); // decorrelated from the first property test's stream, still fixed
  for (let i = 0; i < 200; i++) {
    const atomsA = randomAtoms(rng, 1500);
    const pos = Math.floor(rng() * atomsA.length);
    const atomsB = atomsA.slice();
    let replacement;
    do {
      replacement = ATOMS[Math.floor(rng() * ATOMS.length)];
    } while (replacement === atomsA[pos]);
    atomsB[pos] = replacement;

    const keyA = atomsA.join("");
    const keyB = atomsB.join("");
    const valueA = `pair#${i}::A`;
    const valueB = `pair#${i}::B`;

    const localCtx = new Context(new NextRequest(url()), {});
    localCtx.set(keyA, valueA);
    localCtx.set(keyB, valueB);
    assert.deepEqual(Object.keys(localCtx.values.local), ["$" + keyA, "$" + keyB], `pair #${i} (local)`);
    assert.equal(localCtx.get(keyA), valueA, `pair #${i} (local) keyA did not read back its own value`);
    assert.equal(localCtx.get(keyB), valueB, `pair #${i} (local) keyB did not read back its own value`);

    const id = `ctx-prop-pair-${i}`;
    const sharedCtx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
    sharedCtx.set(keyA, valueA);
    sharedCtx.set(keyB, valueB);
    assert.deepEqual(Object.keys(RequestStore.peek(id)), ["$" + keyA, "$" + keyB], `pair #${i} (shared)`);
    assert.equal(sharedCtx.get(keyA), valueA, `pair #${i} (shared) keyA did not read back its own value`);
    assert.equal(sharedCtx.get(keyB), valueB, `pair #${i} (shared) keyB did not read back its own value`);
  }
});

/* Accepted surviving mutant, per house-rules "an accepted survivor gets
   written down, not silently left" — recorded here, not patched away:
   ANY length cutoff at or above 1494 characters (slice(0, 1494),
   slice(0, 1501), slice(0, 4096)) survives both property tests above;
   slice(0, 1493) and anything shorter dies. 1494 is the longest key SEED
   0x0022_0006 actually produces across both streams — measured, not derived:
   randomAtoms picks a target up to 1500 but stops the moment the string
   reaches it, so the realised maximum sits below the cap and moves with the
   seed (1494 here; 1500 at one other seed we tried). A cutoff at or past the
   longest sample is a no-op on every sample, which is why it cannot be seen.
   No finite test body makes "character for character, for every key"
   literally true for a key of unbounded length — the claim is over an
   infinite domain, and a table or a seeded sample can only ever cover a
   prefix of it. 1500 was chosen as the generator's target cap to sit
   comfortably past every length QA measured this round (259, 260, 512,
   603, 605) with headroom, not because 1500 is itself meaningful. */

/* ---------------------------------------------------------------------- */
/* 16. 0023 phần A: next() carries this.init, not a stale copy of the      */
/*     client's raw headers. Sections continue past 15 rather than         */
/*     re-using 7/8 — those numbers were already spent (see the comment    */
/*     at the top of this file's history and Reviewer 0039's note on the   */
/*     broken numbering); appended here, at the end, rather than inside    */
/*     the ~340-line header-copy block above (0039 mục 1), because that    */
/*     block is about the CONSTRUCTOR seeding init from req.headers — a    */
/*     different claim from this one, which is entirely about next(). This */
/*     section was, until this task, deliberately empty: see this file's   */
/*     own opening comment ("ctx.next() is deliberately untested").        */
/* ---------------------------------------------------------------------- */

test("ctx.next() with no arguments carries every header setHeader placed — a brand-new name, one overriding what the client sent, mixed case, an explicit empty string, and cookie", () => {
  const req = new NextRequest(url(), {
    headers: {
      "x-client-only": "from-client",
      cookie: "session=abc",
    },
  });
  const ctx = new Context(req, {});
  ctx.setHeader("x-brand-new", "mw-value");
  ctx.setHeader("x-client-only", "overridden-by-mw"); // client sent this name too — middleware must win
  ctx.setHeader("X-User", "u-1"); // set under one case
  ctx.setHeader("x-empty", "");
  ctx.setHeader("cookie", "session=abc; extra=1"); // 0024 (cookieJar) rides exactly this path

  const out = forwarded(ctx.next());

  assert.equal(out.get("x-brand-new"), "mw-value", "a brand-new header setHeader added must be forwarded");
  assert.equal(out.get("x-client-only"), "overridden-by-mw", "setHeader must win over what the client sent for the same name");
  assert.equal(out.get("x-user"), "u-1", "read back under lowercase");
  assert.equal(out.get("X-USER"), "u-1", "read back under yet another case — Headers must not distinguish case on either the write or the read side, proven rather than assumed");
  assert.equal(out.has("x-empty"), true, "an explicitly empty value is PRESENT, not the same as never having been set");
  assert.equal(out.get("x-empty"), "", "the empty value itself must survive, not be coerced into something else");
  assert.equal(out.get("cookie"), "session=abc; extra=1", "cookie specifically");
});

test("ctx.next() with no arguments never keeps a header a middleware deleted from this.init — the sharpest case, and the reason the base is this.init and not a merge onto this.req", () => {
  const req = new NextRequest(url(), { headers: { "x-secret": "leak" } });
  const ctx = new Context(req, {});
  ctx.init.request.headers.delete("x-secret");

  const out = forwarded(ctx.next());
  assert.equal(out.has("x-secret"), false, "a header the client sent, explicitly deleted by a middleware, must not be forwarded — a base glued from this.req plus a merge of this.init can only ADD, never remove, so it fails exactly here");
});

test("the init argument to ctx.next() still wins over setHeader for the same header name, and a header present in only one of the two still goes out", () => {
  const ctx = new Context(new NextRequest(url()), {});
  ctx.setHeader("x", "a");
  ctx.setHeader("only-in-setHeader", "sh-value");

  const out = forwarded(ctx.next({ request: { headers: new Headers({ x: "b", "only-in-init": "init-value" }) } }));

  assert.equal(out.get("x"), "b", "the init argument's value must win over setHeader's for the same name — the caller speaking LAST through next() wins");
  assert.equal(out.get("only-in-setHeader"), "sh-value", "a header only setHeader placed must still go out");
  assert.equal(out.get("only-in-init"), "init-value", "a header only the init argument placed must still go out");
});

test("REQUEST_ID on the way out of ctx.next() never comes from the client or a middleware — only from this context's own shared id, or not at all, on either branch and through either setHeader or the init argument", () => {
  const shared1 = new Context(new NextRequest(url()), {}, undefined, { shared: "real-shared-id" });
  shared1.setHeader(REQUEST_ID, "made-up");
  assert.equal(forwarded(shared1.next()).get(REQUEST_ID), "real-shared-id", "setHeader(REQUEST_ID, ...) on a shared context must lose to this.values.shared");

  const shared2 = new Context(new NextRequest(url()), {}, undefined, { shared: "real-shared-id-2" });
  const viaInitShared = forwarded(shared2.next({ request: { headers: new Headers({ [REQUEST_ID]: "made-up-via-init" }) } })).get(REQUEST_ID);
  assert.equal(viaInitShared, "real-shared-id-2", "passing REQUEST_ID through the init argument must lose to this.values.shared too — it is checked AFTER the init merge, not before");

  const local1 = new Context(new NextRequest(url(), { headers: { [REQUEST_ID]: "client-sent" } }), {});
  local1.setHeader(REQUEST_ID, "made-up");
  assert.equal(forwarded(local1.next()).has(REQUEST_ID), false, "a context not on the shared branch must never forward REQUEST_ID, even if a middleware setHeader'd it");

  const local2 = new Context(new NextRequest(url()), {});
  const viaInitLocal = forwarded(local2.next({ request: { headers: new Headers({ [REQUEST_ID]: "made-up-via-init-local" }) } })).has(REQUEST_ID);
  assert.equal(viaInitLocal, false, "passing REQUEST_ID through the init argument on a local context must also be stripped");
});

test("calling ctx.next() a second time, with no arguments, never sees a header that only the FIRST call's init argument supplied", () => {
  /* Only observable with two calls on the SAME context — see the mutation
     floor's own note on this: a base built as `new Headers(this.init.request
     .headers)` copies fresh on every call; a base that reused this.init's
     Headers object directly would let the first call's merge permanently
     graft onto this.init, and a later argument-less call would still be
     carrying it. */
  const ctx = new Context(new NextRequest(url()), {});
  ctx.setHeader("base", "b1");

  const first = forwarded(ctx.next({ request: { headers: new Headers({ "only-in-first-call": "f1" }) } }));
  assert.equal(first.get("only-in-first-call"), "f1", "sanity: the first call's own init argument must appear in the first call's own output");

  const second = forwarded(ctx.next());
  assert.equal(second.has("only-in-first-call"), false, "a header supplied only through the FIRST call's init argument must not bleed into a second, argument-less call");
  assert.equal(second.get("base"), "b1", "setHeader's own value must still be there on the second call");
});

test("two ways of ending a middleware — `ctx.setHeader(...); return ctx.next();` versus `ctx.setHeader(...);` with no return at all — forward the exact same set of headers, through every way a Proxy can be built", async () => {
  const withReturn = (ctx) => { ctx.setHeader("x-a", "1"); return ctx.next(); };
  const withoutReturn = (ctx) => { ctx.setHeader("x-a", "1"); };
  const noop = () => {};

  async function compare(build) {
    const resReturn = await build(withReturn)(new NextRequest(url()), payload());
    const resNoReturn = await build(withoutReturn)(new NextRequest(url()), payload());
    const a = forwarded(resReturn);
    const b = forwarded(resNoReturn);

    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), "the two middleware endings must forward the exact same set of header NAMES");
    for (const key of a.keys()) {
      /* Each call mints its own fresh, signed request id — the two ids are
         SUPPOSED to differ from each other; only their presence was checked
         above. Comparing REQUEST_ID's VALUE across the two calls would be
         asserting something the id's own design says should be false. */
      if (key === REQUEST_ID) continue;
      assert.equal(a.get(key), b.get(key), `header "${key}" must carry the same value both ways`);
    }
  }

  await compare((fn) => Proxy.use(fn).proxy());
  await compare((fn) => Proxy.use(fn).proxy(noop)); // .use(f).proxy(g) — g runs only when f falls through
  await compare((fn) => Proxy(fn));
});

test("0023 §6, end-to-end through dist: ctx.next() never drops a client header a middleware never touched — cookie, authorization and a custom header all ride through to the Route, alongside whatever the middleware itself set", async () => {
  /* The middleware below touches none of cookie/authorization/x-client-custom
     and returns nothing, so this exercises the IMPLICIT fallthrough path —
     proxy.ts's own `return context.res.next(context.init)` at the end of
     `serve()` — not a `ctx.next()` call written inside the middleware. Both
     paths funnel through the same `next()`/`Res.next`, but this is the shape
     0024's cookieJar and 0025's csrf are actually going to run through. */
  const proxy = Proxy({}).use((ctx) => { ctx.setHeader("x-mw-added", "mw-1"); });

  const clientHeaders = {
    cookie: "session=abc123",
    authorization: "Bearer tok-1",
    "x-client-custom": "custom-1",
  };
  const passed = await proxy(new NextRequest(url("/page"), { headers: clientHeaders }), payload());
  const nextHeaders = forwarded(passed);

  const { GET } = Route().get((ctx) => ({
    cookie: ctx.req.headers.get("cookie"),
    authorization: ctx.req.headers.get("authorization"),
    custom: ctx.req.headers.get("x-client-custom"),
    mwAdded: ctx.req.headers.get("x-mw-added"),
  }));

  const res = await GET(new NextRequest(url(), { headers: nextHeaders }), payload());
  const data = (await res.json()).data;

  assert.equal(data.cookie, "session=abc123", "cookie the client sent, never touched by the middleware, must reach the Route");
  assert.equal(data.authorization, "Bearer tok-1", "authorization the client sent, never touched by the middleware, must reach the Route");
  assert.equal(data.custom, "custom-1", "a custom client header never touched by the middleware must reach the Route");
  assert.equal(data.mwAdded, "mw-1", "the header the middleware itself set must ALSO reach the Route, alongside the untouched client headers");
});

/* ---------------------------------------------------------------------- */
/* 17. 0023 phần C: a bare key in a hand-built `local` seed is prefixed    */
/*     in place before the constructor finishes — the "fourth way in"      */
/*     ContextValues' own comment, and the constructor's normalization     */
/*     loop, describe.                                                     */
/* ---------------------------------------------------------------------- */

const BARE_KEY_CASES = [
  {
    axis: "a single bare key with no prefixed counterpart",
    build: () => ({ userId: "u1" }),
    check: (ctx) => assert.equal(ctx.get("userId"), "u1"),
    expectedKeys: ["$userId"],
  },
  {
    axis: "a key that already carries the prefix",
    build: () => ({ $userId: "u1" }),
    check: (ctx) => {
      assert.equal(ctx.get("userId"), "u1");
      assert.equal(ctx.get("$userId"), undefined, 'get("$userId") would need a caller key of literally "$userId" — a seed of {"$userId":...} means the key "userId", already prefixed, not the key "$userId"');
    },
    expectedKeys: ["$userId"],
  },
  {
    axis: "a bare key colliding with its own already-prefixed counterpart in the same seed",
    build: () => ({ userId: "u1", $userId: "u2" }),
    check: (ctx) => assert.equal(ctx.get("userId"), "u2", "the already-prefixed value must win over the bare one"),
    expectedKeys: ["$userId"],
  },
  {
    axis: "an empty seed",
    build: () => ({}),
    check: (ctx) => assert.equal(ctx.get("x"), undefined),
    expectedKeys: [],
  },
  {
    axis: '"__proto__" as an own enumerable key, built via JSON.parse so it lands as data instead of setting the prototype',
    build: () => JSON.parse('{"__proto__":1}'),
    check: (ctx) => {
      assert.equal(ctx.get("__proto__"), 1);
      assert.equal({}.polluted, undefined, "normalizing a key literally named __proto__ must never touch Object.prototype");
    },
    expectedKeys: ["$__proto__"],
  },
  {
    axis: "keys that shadow Object.prototype method names",
    build: () => ({ constructor: 1, toString: 2 }),
    check: (ctx) => {
      assert.equal(ctx.get("constructor"), 1);
      assert.equal(ctx.get("toString"), 2);
    },
    expectedKeys: ["$constructor", "$toString"],
  },
  {
    axis: "the empty string as a key",
    build: () => ({ "": 1 }),
    check: (ctx) => assert.equal(ctx.get(""), 1),
    expectedKeys: ["$"],
  },
  {
    axis: 'a seed key of literally "$" — the empty caller key, already prefixed',
    build: () => ({ "$": 1 }),
    check: (ctx) => assert.equal(ctx.get(""), 1),
    expectedKeys: ["$"],
  },
  {
    axis: "an inherited key sitting on the seed's prototype, never its own",
    build: () => {
      const seed = Object.create({ inherited: 1 });
      seed.a = 2;
      return seed;
    },
    check: (ctx) => {
      assert.equal(ctx.get("a"), 2);
      assert.equal(ctx.get("inherited"), undefined, "an inherited key must never be pulled into the bag as if it were the caller's own");
    },
    expectedKeys: ["$a"],
  },
  {
    axis: "a key whose value is undefined — present, but empty",
    build: () => ({ a: undefined }),
    check: (ctx) => assert.equal(ctx.get("a"), undefined),
    expectedKeys: ["$a"],
  },
];

test('a bare key in a hand-built `local` seed is prefixed in place before the constructor finishes — 10 cases, each pinning both get() and the seed\'s own physical keys afterward', () => {
  for (const { axis, build, check, expectedKeys } of BARE_KEY_CASES) {
    const seed = build();
    const ctx = new Context(new NextRequest(url()), {}, undefined, { local: seed });
    check(ctx);
    assert.deepEqual(
      Object.keys(ctx.values.local).sort(),
      [...expectedKeys].sort(),
      `[${axis}] unexpected physical own keys after normalization — get() alone would not have caught a bare key left sitting alongside its prefixed twin`,
    );
  }
});

test("the normalization loop never touches the shared branch: set/get still go through RequestStore, and building with only `shared` never throws even though values.local does not exist", () => {
  const id = "ctx-c-shared-untouched";
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
  ctx.set("userId", "u1");
  assert.equal(ctx.get("userId"), "u1");
  assert.deepEqual(Object.keys(RequestStore.peek(id)), ["$userId"]);
});

test("building a Context with no fourth argument at all still normalizes the (empty) default bag without throwing", () => {
  const ctx = new Context(new NextRequest(url()), {});
  assert.deepEqual(Object.keys(ctx.values.local), []);
});

test("destroy() still leaves the seed object itself with no own keys, even after an extra ctx.set() lands on top of it after construction", () => {
  const seed = { userId: "u1", role: "r1" };
  const ctx = new Context(new NextRequest(url()), {}, undefined, { local: seed });
  ctx.set("extra", "e1");
  ctx.destroy();

  /* Reading `seed` — the exact object the caller passed in, not
     `ctx.values.local` — is the point: a normalization that worked on a
     COPY would leave `this.values.local` pointing at that copy, which
     destroy() would empty correctly, while this original `seed` variable
     sat forever with its two pristine bare keys untouched. Only looking at
     the caller's own reference tells the two implementations apart. */
  assert.deepEqual(Object.keys(seed), [], "the original seed object must end up with no own keys — a copy-based normalization would leave userId/role sitting on THIS object forever, since destroy() only ever clears this.values.local");
});

test("normalizing in place is observable on purpose: a caller holding its own seed object sees that exact object gain $userId and lose userId once the Context is built", () => {
  const seed = { userId: "u1" };
  new Context(new NextRequest(url()), {}, undefined, { local: seed });

  assert.deepEqual(Object.keys(seed), ["$userId"], "the caller's own seed object must be the one renamed — not a copy the caller never sees");
  assert.equal(seed.$userId, "u1");
  assert.equal("userId" in seed, false);
});

test("0023 end-to-end: a value a Proxy's middleware sets still reaches the Route correctly — the constructor's normalization loop leaves an already-prefixed claim() result alone", async () => {
  const proxy = Proxy({}).use((ctx) => ctx.set("normCheck", "n1"));
  const id = forwarded(await proxy(new NextRequest(url("/api/x")), payload())).get(REQUEST_ID);

  const { GET } = Route().get((ctx) => ctx.get("normCheck") ?? null);
  const res = await GET(new NextRequest(url(), { headers: { [REQUEST_ID]: id } }), payload());
  assert.equal((await res.json()).data, "n1", 'the loop added in this task must not disturb a claim() result that already carries the "$" prefix — see row 2 of the bare-key table above for the same guarantee at the unit level');
});

/* Out of scope, noted rather than handled (task 0023's own boundary): a
   `local` bag that is `Object.freeze`d would make the normalization loop's
   own `delete`/assignment throw under strict mode (ESM is always strict).
   Nothing in this package freezes a seed today, and nothing above
   constructs one that way — not tested here. */
