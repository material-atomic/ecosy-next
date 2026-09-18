/* Net under `src/context.ts`, ahead of 0022/0023/0024/0025/0026/0027 touching it.
   Every test here hunts a counter-example to one of the promises listed in
   0021, not just a happy path. `ctx.next()` is deliberately untested — its
   behavior is 0023's, and about to change. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Context, Memory } = require("../dist/index.js");
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
   Proxy→Route in request-id.test.mjs. */
test("Context.set and Context.get on a shared-branch Context round-trip through RequestStore, not a local object", () => {
  const id = "ctx-shared-roundtrip";
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });

  ctx.set("k", "v");

  assert.equal(ctx.get("k"), "v");
  assert.deepEqual(RequestStore.peek(id), { k: "v" }, "the value actually landed in RequestStore under the shared id");
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

test("destroy() on a shared-branch Context does nothing: RequestStore.peek still sees the value afterward", () => {
  const id = "ctx-shared-destroy-noop";
  const ctx = new Context(new NextRequest(url()), {}, undefined, { shared: id });
  ctx.set("k", "v");

  assert.doesNotThrow(() => ctx.destroy());
  assert.deepEqual(RequestStore.peek(id), { k: "v" }, "a route already claimed the shared entry by the time destroy() runs — destroy has nothing of its own to clear there");
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
