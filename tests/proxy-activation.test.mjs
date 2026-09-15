/* In its own file on purpose: `node --test` runs each file in its own process,
   and marking the app as proxied is one-way for the life of a process. The
   tests run in order — the first one needs a process nothing has marked yet. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Route, Proxy, Memory } = require("../dist/index.js");
const { NextRequest } = require("next/server");

const payload = () => ({ params: Promise.resolve({}) });
const url = "http://localhost/api/x";

test("importing the package does not mark the app as proxied", async () => {
  assert.equal(Memory.isProxyActivated, false);

  const { GET } = Route()
    .use((ctx) => ctx.set("who", "me"))
    .get((ctx) => ctx.get("who"));
  const res = await GET(new NextRequest(url, { headers: { "x-ecosyrequest-id": "whatever-a-client-sends" } }), payload());

  assert.equal((await res.json()).data, "me", "a route without a proxy answers, ignoring any id the client sent");
});

test("building a Proxy marks it, and from then on a route needs the id the proxy issued", async () => {
  const proxy = Proxy({});
  assert.equal(Memory.isProxyActivated, true);

  const { GET } = Route().get(() => "ok");
  await assert.rejects(GET(new NextRequest(url), payload()), /Missing 'x-ecosyrequest-id'/);

  const passed = await proxy(new NextRequest(url), payload());
  const id = passed.headers.get("x-middleware-request-x-ecosyrequest-id");
  const res = await GET(new NextRequest(url, { headers: { "x-ecosyrequest-id": id } }), payload());
  assert.equal((await res.json()).data, "ok");
});
