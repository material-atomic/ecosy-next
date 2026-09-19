/* State leaking between requests through a TOKEN instance — as opposed to
   through the Context, which is fresh every request — is a property of
   `resolve()` (container.ts:44-66): one instance per class for the whole
   process, on a WeakMap hung off `globalThis`. It predates this task, is
   unrelated to *how* a token gets delivered onto the context (own accessor
   in 2.0.0, own data property after 0064, a getter on a subclass's prototype
   in the v3 prototype nobody shipped) — every one of those calls the exact
   same `resolve()` — and task 0064 is explicit that fixing it is a product
   decision nobody has made (0064 §4, Đ2 in its debt list).
   This file exists to CANCH the number, not to change the behaviour: run it
   again after any future change and 999 should still be 999. If it turns
   into 1000, or 0, something about `resolve()` moved and needs its own
   decision, not a silent update to this test. In its own file (not appended
   to container.test.mjs) because `node --test` gives each file its own
   process, and this measurement wants a clean run of exactly 1000 requests
   with nothing else having touched the container first. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Route, Gateway } = require("../dist/index.js");
const { NextRequest } = require("next/server");

const gateway = Gateway({});
const FORWARDED = "x-middleware-request-";
const payload = () => ({ params: Promise.resolve({}) });

async function request(path = "/api/x") {
  const url = `http://localhost${path}`;
  const passed = await gateway(new NextRequest(url), payload());
  const forwarded = new Headers();
  for (const [name, value] of passed.headers) {
    if (name.startsWith(FORWARDED)) forwarded.set(name.slice(FORWARDED.length), value);
  }
  return new NextRequest(url, { headers: forwarded });
}

test("state a handler writes onto a token is still visible to the next request — 999 of 1000, by design", async () => {
  const N = 1000;

  class Marker {
    static count = 0;
    constructor() {
      Marker.count++;
    }
  }

  const { GET } = Route({ marker: Marker }).get((ctx) => {
    /* This writes onto the TOKEN's own instance, not onto `ctx` — the wrong
       shape CHANGELOG.md warns about. `ctx.set`/`ctx.get` would have been
       the right one; those go through RequestStore or a fresh `local` bag
       per Context and do not exhibit this. */
    const sawPrior = ctx.marker.touched === true;
    ctx.marker.touched = true;
    return { sawPrior };
  });

  let sawPriorCount = 0;
  for (let i = 0; i < N; i++) {
    const res = await GET(await request(), payload());
    const body = await res.json();
    if (body.data.sawPrior) sawPriorCount++;
  }

  /* N-1, not N: the very first request in the process has no request before
     it to see. This is the "999, not 1000" the task calls out by name —
     rounding it to 1000 would be reporting a number nobody measured. */
  assert.equal(sawPriorCount, N - 1, "every request but the first sees the previous one's write");
  assert.equal(Marker.count, 1, "one instance for the whole run — which is exactly why the state above is visible at all");
});
