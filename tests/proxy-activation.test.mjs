/* In its own file on purpose: `node --test` runs each file in its own process,
   and marking the app as proxied is one-way for the life of a process. The
   tests run in order — the first one needs a process nothing has marked yet. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { Route, Gateway, Memory } = require("../dist/index.js");
const { NextRequest } = require("next/server");

const payload = () => ({ params: Promise.resolve({}) });
const url = "http://localhost/api/x";

test("importing the package does not mark the app as proxied", async () => {
  assert.equal(Memory.isGatewayActivated, false);

  const { GET } = Route()
    .use((ctx) => ctx.set("who", "me"))
    .get((ctx) => ctx.get("who"));
  const res = await GET(new NextRequest(url, { headers: { "x-ecosyrequest-id": "whatever-a-client-sends" } }), payload());

  assert.equal((await res.json()).data, "me", "a route without a proxy answers, ignoring any id the client sent");
});

test("building a Gateway marks it, and from then on a route needs the id the proxy issued", async () => {
  const proxy = Gateway({});
  assert.equal(Memory.isGatewayActivated, true);

  const { GET } = Route().get(() => "ok");
  await assert.rejects(GET(new NextRequest(url), payload()), /Missing 'x-ecosyrequest-id'/);

  const passed = await proxy(new NextRequest(url), payload());
  const id = passed.headers.get("x-middleware-request-x-ecosyrequest-id");
  const res = await GET(new NextRequest(url, { headers: { "x-ecosyrequest-id": id } }), payload());
  assert.equal((await res.json()).data, "ok");
});

/* Spawns its own process, so it does not touch this file's one-way flags —
   the reason it can sit in this file at all, per the file's own opening
   comment, is that it never calls anything from this package in the CURRENT
   process. It runs the destructuring itself with `node -e`, not with a
   required module, because that distinction is the entire mechanism: a
   `.js` file loaded by `require()` wraps its top level in a function, so a
   `const` there is scoped to that function and nothing else. `-e` (like a
   REPL, or `vm.runInThisContext`) evaluates its top level directly against
   the realm's global environment, so a `const` there lands in the SAME
   scope every other module in that process falls back to when it can't
   resolve a name locally — including `next/server`'s own module, and
   including JavaScript's own `Proxy`. QA 0059 §3 found the collision this
   way: `const { Proxy } = require("@ecosy/next")` at that scope shadowed
   the real `Proxy` for `next/server`'s `NextResponse` constructor, which
   calls `new Proxy(cookies, {...})` internally.
   The destructuring list below is generated from whatever the built package
   actually exports, not hand-typed — a hand-typed list that happened not to
   include "Proxy" would prove nothing about whether OUR renamed export
   still causes the same collision under a P11-style mutation (re-adding
   `export const Proxy = Gateway`). Generating it is what makes this a
   positive test instead of `assert.equal(pkg.Proxy, undefined)`, which 0064
   §8 T8 calls out by name as insufficient on its own. */
test("destructuring every export of the package into global scope leaves JavaScript's own `Proxy` alone — a NextResponse built afterwards still works", () => {
  const distIndex = require.resolve("../dist/index.js");
  const names = Object.keys(require(distIndex));
  assert.ok(names.length > 10, "sanity check: the package still exports a reasonable number of names");

  const script = [
    `const pkg = require(${JSON.stringify(distIndex)});`,
    `const { ${names.join(", ")} } = pkg;`,
    `void [${names.join(", ")}];`,
    `const { NextResponse } = require(${JSON.stringify(require.resolve("next/server"))});`,
    // NextResponse's constructor calls `new Proxy(cookies, {...})`
    // internally, and stores the result as `this.cookies`. Building the
    // response alone is not enough to catch a shadowed `Proxy`: if `Proxy`
    // resolved to a plain function (P11's `export const Proxy = Gateway`,
    // say) instead of the real constructor, `new Gateway(cookies, handler)`
    // does not THROW — Gateway's factory happily treats `cookies` as an
    // injects map and returns a callable, and the constructor finishes.
    // The break only shows up the moment something calls a method the real
    // Proxy's trap would have handled and this callable does not have —
    // `.set` is exactly that method, and it is the one an app calls on
    // every request that sets a cookie.
    `const res = NextResponse.next();`,
    `res.cookies.set("probe", "1");`,
    `process.stdout.write("OK " + (res.headers.get("set-cookie") ?? "") + " " + res.constructor.name);`,
  ].join("\n");

  /* Same reason every other file in this suite loads it: `server-only`
     throws outside a real Next request unless something swaps it for an
     empty module first, and `dist/cookie.js` — reached transitively off
     `pkg`'s own `cookie-jar` export — imports it. Without `--import` here,
     this test would fail on that unrelated module-resolution detail instead
     of measuring the thing it is actually about. */
  const hooks = new URL("./hooks.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", hooks, "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `unexpected exit ${result.status}`);
  assert.equal(result.stdout, "OK probe=1; Path=/ NextResponse");
});
