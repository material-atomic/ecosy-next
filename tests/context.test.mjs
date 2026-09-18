/* Net under `src/context.ts`, ahead of 0022/0023/0024/0025/0026/0027 touching it.
   Every test here hunts a counter-example to one of the promises listed in
   0021, not just a happy path. `ctx.next()` is deliberately untested — its
   behavior is 0023's, and about to change. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

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
/* Coverage gaps named in 0021 that are not "must not" hunts: uri,        */
/* baseUrl, env.                                                         */
/* ---------------------------------------------------------------------- */

test("baseUrl returns the incoming request's origin", () => {
  const ctx = new Context(new NextRequest("http://localhost:3000/api/x?y=1"), {});
  assert.equal(ctx.baseUrl, "http://localhost:3000");
});

test("uri builds an absolute URL on baseUrl, with path and query from its options", () => {
  const ctx = new Context(new NextRequest("http://localhost:3000/api/x"), {});
  assert.equal(ctx.uri({ pathname: "/foo", search: { a: 1 } }), "http://localhost:3000/foo?a=1");
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
