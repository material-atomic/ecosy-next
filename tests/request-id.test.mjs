/* The request id a Proxy issues and a Route requires: signed, never taken from
   the client, good for one handoff. In its own file — marking a process as
   proxied is one-way, and the first test needs a process that has not issued
   an id yet. The tests run in order. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Route, Proxy } = require("../dist/index.js");
const { NextRequest } = require("next/server");

const ID = "x-ecosyrequest-id";
const SIGNED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const FORWARDED = "x-middleware-request-";
const payload = () => ({ params: Promise.resolve({}) });
const url = (path = "/api/x") => `http://localhost${path}`;

/** The request headers a proxy response forwards, as Next reads them. */
function forwarded(response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name.startsWith(FORWARDED)) headers.set(name.slice(FORWARDED.length), value);
  }
  return headers;
}

let middlewareRuns = 0;
const proxy = Proxy({}).use((ctx) => {
  middlewareRuns++;
  if (ctx.url.pathname.startsWith("/api/")) ctx.set("userId", ctx.req.headers.get("x-user"));
});

test("an id another process issued is refused as foreign, by name", async () => {
  const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const script = `const { Proxy } = require(${JSON.stringify(dist)});
    const { NextRequest } = require("next/server");
    Proxy({})(new NextRequest("http://localhost/api/x"), { params: Promise.resolve({}) })
      .then((res) => process.stdout.write(res.headers.get("${FORWARDED}${ID}") ?? ""));`;
  const other = execFileSync(process.execPath, ["--import", fileURLToPath(new URL("./hooks.mjs", import.meta.url)), "-e", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.match(other, SIGNED, "the other process issued a well-formed id");

  const { GET } = Route().get(() => "ok");
  await assert.rejects(GET(new NextRequest(url(), { headers: { [ID]: other } }), payload()), /not minted by this process/);
});

test("the proxy issues a signed id and forwards it", async () => {
  const id = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(ID);
  assert.match(id, SIGNED);
});

test("a forged id is refused with 400 before any middleware runs", async () => {
  const before = middlewareRuns;
  for (const forged of ["abc", `${crypto.randomUUID()}.${"A".repeat(43)}`]) {
    const res = await proxy(new NextRequest(url(), { headers: { [ID]: forged } }), payload());
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Invalid x-ecosyrequest-id header");
  }
  assert.equal(middlewareRuns, before, "no middleware ran");
});

test("an id the proxy issued, sent back to it, is not reused — the request gets a fresh one", async () => {
  const first = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(ID);
  const again = forwarded(await proxy(new NextRequest(url("/page"), { headers: { [ID]: first } }), payload())).get(ID);
  assert.match(again, SIGNED);
  assert.notEqual(again, first);
});

test("a route takes what the proxy set, once: the same id sent again finds nothing", async () => {
  const headers = forwarded(await proxy(new NextRequest(url(), { headers: { "x-user": "u-42" } }), payload()));
  const { GET } = Route().get((ctx) => ctx.get("userId") ?? null);

  const served = await GET(new NextRequest(url(), { headers }), payload());
  assert.equal((await served.json()).data, "u-42");

  const replayed = await GET(new NextRequest(url(), { headers: { [ID]: headers.get(ID) } }), payload());
  assert.equal((await replayed.json()).data, null);
});

test("a route refuses an altered id, and a request with none", async () => {
  const id = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(ID);
  const altered = `${crypto.randomUUID()}.${id.split(".")[1]}`;
  const { GET } = Route().get(() => "ok");

  await assert.rejects(GET(new NextRequest(url(), { headers: { [ID]: altered } }), payload()), /Invalid 'x-ecosyrequest-id'/);
  await assert.rejects(GET(new NextRequest(url()), payload()), /Missing 'x-ecosyrequest-id'/);
});

test("ctx.next() forwards the proxy's id, not one the client sent", async () => {
  const replayed = forwarded(await proxy(new NextRequest(url("/page")), payload())).get(ID);
  const passthrough = Proxy({}).use((ctx) => ctx.next());

  const sent = forwarded(await passthrough(new NextRequest(url("/page"), { headers: { [ID]: replayed } }), payload())).get(ID);
  assert.match(sent, SIGNED);
  assert.notEqual(sent, replayed);
});

test("the handoff store is bounded: 10 000 entries, a minute each", async () => {
  const store = globalThis[Symbol.for("@ecosy/next:request-store")];
  const setter = Proxy({}).use((ctx) => {
    ctx.set("n", 1);
  });
  const realNow = Date.now;

  try {
    for (let i = 0; i < 10_050; i++) await setter(new NextRequest(url("/page")), payload());
    assert.equal(store.size, 10_000, "the oldest entries went first");

    const later = realNow() + 61_000;
    Date.now = () => later;
    await setter(new NextRequest(url("/page")), payload());
    assert.equal(store.size, 1, "a minute on, only the newest is left");
  } finally {
    Date.now = realNow;
  }
});
