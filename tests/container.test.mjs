/* Runs against the built package (`yarn build` first), CommonJS and ESM both,
   with the real `next/server`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Route, Proxy, Handler, Bootstrap } = require("../dist/index.js");
const { Inject } = require("../dist/inject.js");
const { NextRequest } = require("next/server");

/* Every request goes through a Proxy first, as it does in an app: the proxy
   issues a signed id, and a Route in a proxied process refuses a request
   without one. The id arrives the way Next forwards it, as the
   `x-middleware-request-*` headers of the proxy's response. */
const gateway = Proxy({});
const FORWARDED = "x-middleware-request-";

async function request(path = "/api/x", headers = {}) {
  const url = `http://localhost${path}`;
  const passed = await gateway(new NextRequest(url, { headers }), payload());
  const forwarded = new Headers(headers);
  for (const [name, value] of passed.headers) {
    if (name.startsWith(FORWARDED)) forwarded.set(name.slice(FORWARDED.length), value);
  }
  return new NextRequest(url, { headers: forwarded });
}

const payload = () => ({ params: Promise.resolve({}) });

/** A token class that counts its constructions. */
function counted(name) {
  const Token = class {
    constructor() {
      Token.count++;
      this.id = `${name}#${Token.count}`;
    }
  };
  Object.defineProperty(Token, "name", { value: name });
  Token.count = 0;
  return Token;
}

async function quiet(fn) {
  const { error, log } = console;
  console.error = console.log = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, log });
  }
}

test("only a token that is read gets built, once for every request", async () => {
  const A = counted("A");
  const B = counted("B");
  const contexts = [];

  const { GET } = Route({ a: A, b: B }).get((ctx) => {
    contexts.push(ctx);
    return ctx.a.id;
  });

  for (let i = 0; i < 3; i++) {
    const res = await GET(await request(), payload());
    assert.equal((await res.json()).data, "A#1");
  }

  assert.equal(A.count, 1);
  assert.equal(B.count, 0, "b was never read");
  assert.equal(new Set(contexts).size, 3, "one new context per request");
  assert.ok(contexts.every((ctx) => ctx.a === contexts[0].a));
});

test("one class is one instance across Route, Proxy, Handler, Bootstrap and Inject", async () => {
  const Shared = counted("Shared");
  const seen = [];

  const { GET } = Route({ s: Shared }).get((ctx) => {
    seen.push(ctx.s);
    return null;
  });
  await GET(await request(), payload());

  await Proxy({ s: Shared }).use((ctx) => {
    seen.push(ctx.s);
  })(await request("/page"), payload());

  const handled = Handler({ s: Shared }).handle((ctx) => {
    seen.push(ctx.s);
    return null;
  });
  const { POST } = Route().post(handled);
  await POST(await request(), payload());

  await quiet(() =>
    Bootstrap({ s: Shared })
      .push((ctx) => {
        seen.push(ctx.s);
      })
      .start((ctx) => {
        seen.push(ctx.s);
      })
      .init()
  );

  class Base extends Inject({ s: Shared }) {}
  seen.push(new Base().s, new Base().s);

  const plain = {};
  Inject.inject(plain, { s: Shared });
  seen.push(plain.s);

  assert.equal(seen.length, 8);
  assert.ok(seen.every((instance) => instance === seen[0]));
  assert.equal(Shared.count, 1);
});

test("a token nested through extends Inject is built once, and only when read", async () => {
  const Logger = counted("Logger");
  let depsBuilt = 0;

  class Deps extends Inject({ logger: Logger }) {
    constructor() {
      super();
      depsBuilt++;
    }
  }

  const mine = new Deps();
  const alsoMine = new Deps();

  let fromRoute;
  const { GET } = Route({ deps: Deps }).get((ctx) => {
    fromRoute = ctx.deps;
    return null;
  });
  await GET(await request(), payload());
  await GET(await request(), payload());

  assert.equal(depsBuilt, 3, "two by hand, one by the container across both requests");
  assert.equal(Logger.count, 0, "nobody has read logger yet");

  assert.equal(mine.logger, alsoMine.logger);
  assert.equal(mine.logger, fromRoute.logger);
  assert.equal(Logger.count, 1);
});

test("a constructor that throws caches nothing, and its error goes through the route's filter", async () => {
  let attempts = 0;
  class Flaky {
    constructor() {
      attempts++;
      if (attempts === 1) throw new Error("database not up yet");
    }
    ok() {
      return "ok";
    }
  }

  const filtered = [];
  const { GET } = Route({ flaky: Flaky })
    .filter((e) => {
      filtered.push(e);
    })
    .get((ctx) => ctx.flaky.ok());

  const first = await quiet(async () => GET(await request(), payload()));
  assert.equal((await first.json()).status, 500);
  assert.equal(filtered[0]?.message, "database not up yet");

  const second = await GET(await request(), payload());
  assert.equal((await second.json()).data, "ok");

  await GET(await request(), payload());
  assert.equal(attempts, 2);
});

test("a cycle is reported by name, not as a stack overflow", async () => {
  class X {
    constructor() {
      Inject.inject(this, { y: Y });
      void this.y;
    }
  }
  class Y {
    constructor() {
      Inject.inject(this, { x: X });
      void this.x;
    }
  }

  const filtered = [];
  const { GET } = Route({ x: X })
    .filter((e) => {
      filtered.push(e);
    })
    .get((ctx) => ctx.x);

  await quiet(async () => GET(await request(), payload()));

  assert.equal(filtered[0]?.message, "@ecosy/next: circular token X → Y → X");
  assert.equal(globalThis[Symbol.for("@ecosy/next:container")].constructing.length, 0);
});

test("a token that is not a class is refused when it is defined", () => {
  assert.throws(() => Inject.inject({}, { a: 1 }), {
    name: "TypeError",
    message: '@ecosy/next: token "a" is not a class',
  });
});

test("two concurrent requests keep their own payload, keyed by their own context's id", async () => {
  const { GET } = Route()
    .use(async (ctx) => {
      ctx.set("who", ctx.req.headers.get("x-user"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    })
    .get((ctx) => ctx.get("who"));

  const [an, binh] = await Promise.all([
    GET(await request("/api/x", { "x-user": "an" }), payload()),
    GET(await request("/api/x", { "x-user": "binh" }), payload()),
  ]);

  assert.equal((await an.json()).data, "an");
  assert.equal((await binh.json()).data, "binh");
});

test("the CommonJS and ESM builds in one process share one instance", async () => {
  const esm = await import("../dist/inject.mjs");
  const Dual = counted("Dual");

  const viaCjs = {};
  const viaEsm = {};
  Inject.inject(viaCjs, { t: Dual });
  esm.Inject.inject(viaEsm, { t: Dual });

  assert.notEqual(esm.Inject, Inject, "really two module instances");
  assert.equal(viaCjs.t, viaEsm.t);
  assert.equal(Dual.count, 1);
});

test("Proxy: a middleware returning a Response stops the chain, otherwise it continues", async () => {
  const blocked = await Proxy({}).use(() => new Response("no", { status: 401 }))(await request("/page"), payload());
  assert.equal(blocked.status, 401);

  const passed = await Proxy({}).use(() => {})(await request("/page"), payload());
  assert.equal(passed.headers.get("x-middleware-next"), "1");
});
