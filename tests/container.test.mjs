/* Runs against the built package (`yarn build` first), CommonJS and ESM both,
   with the real `next/server`. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Route, Gateway, Handler, Bootstrap } = require("../dist/index.js");
const { Inject } = require("../dist/inject.js");
const { NextRequest } = require("next/server");

/* Every request goes through a Gateway first, as it does in an app: the proxy
   issues a signed id, and a Route in a proxied process refuses a request
   without one. The id arrives the way Next forwards it, as the
   `x-middleware-request-*` headers of the proxy's response. */
const gateway = Gateway({});
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

/* Renamed for 0064: eager `defineTokens` builds every declared token with
   the context, not the first time a handler happens to read one — so "only
   a token that is read gets built" is no longer true, and B.count is 1 here,
   not 0. What IS still true, and still worth a name of its own, is that a
   class is built once per process no matter how many requests declare it —
   that is `resolve()`'s cache, untouched by this task, and A.count staying
   at 1 across three requests is what pins it. */
test("a token declared and never read is built anyway — the count is one per class per process, not one per read", async () => {
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

  assert.equal(A.count, 1, "read every time, still one instance for the process");
  assert.equal(B.count, 1, "never read by the handler, but declared — built once anyway, not zero times");
  assert.equal(new Set(contexts).size, 3, "one new context per request");
  assert.ok(contexts.every((ctx) => ctx.a === contexts[0].a));
});

test("one class is one instance across Route, Gateway, Handler, Bootstrap and Inject", async () => {
  const Shared = counted("Shared");
  const seen = [];

  const { GET } = Route({ s: Shared }).get((ctx) => {
    seen.push(ctx.s);
    return null;
  });
  await GET(await request(), payload());

  await Gateway({ s: Shared }).use((ctx) => {
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

/* Renamed for 0064: `Inject()`'s base class constructor calls the same
   defineTokens as Route and Gateway (see container.ts §6.1's five call
   sites), so `logger` is resolved the moment `new Deps()` runs — not
   deferred to "only when read". Nợ N7 of 0059 (Inject() not sharing v3's
   speedup) closes as a side effect of there being only one function left to
   patch. */
test("a token nested through extends Inject is built once, with the class — the same instance the route sees", async () => {
  const Logger = counted("Logger");
  let depsBuilt = 0;

  class Deps extends Inject({ logger: Logger }) {
    constructor() {
      super();
      depsBuilt++;
    }
  }

  const mine = new Deps();
  assert.equal(Logger.count, 1, "built the instant the base class's constructor ran, before Deps's own body");

  const alsoMine = new Deps();

  let fromRoute;
  const { GET } = Route({ deps: Deps }).get((ctx) => {
    fromRoute = ctx.deps;
    return null;
  });
  await GET(await request(), payload());
  await GET(await request(), payload());

  assert.equal(depsBuilt, 3, "two by hand, one by the container across both requests");

  assert.equal(mine.logger, alsoMine.logger);
  assert.equal(mine.logger, fromRoute.logger);
  assert.equal(Logger.count, 1, "still one instance for the process, no matter how many things declare the token");
});

test("every declared token is an own enumerable property of the context — `Object.keys`, object spread and `JSON.stringify` all see the same instance `ctx.db` hands back", async () => {
  const Db = counted("Db");
  let ctx;

  const { GET } = Route({ db: Db }).get((context) => {
    ctx = context;
    return null;
  });
  await GET(await request(), payload());

  const resolved = ctx.db;
  assert.ok(resolved instanceof Db);

  /* Each assertion below is a place a "does it still work" check that stops
     at `!== undefined` would pass even if a bad patch swapped in a lookalike
     object instead of the real singleton — see 0059 §2.3. Every one here
     checks IDENTITY or an own field of the real instance, not just presence. */
  assert.ok(Object.keys(ctx).includes("db"), "Object.keys lists it");
  assert.equal({ ...ctx }.db, resolved, "object spread carries the exact same instance");

  const roundTripped = JSON.parse(JSON.stringify(ctx));
  assert.equal(roundTripped.db.id, resolved.id, "JSON.stringify serializes the same instance's own fields, not an empty object");

  let seenInForIn = false;
  for (const key in ctx) if (key === "db") seenInForIn = true;
  assert.ok(seenInForIn, "for..in walks it too — it was never only an enumerable-flag story");
});

test("a route declaring five tokens lists all five, not just the first and not all-but-the-last", async () => {
  const tokens = {};
  for (let i = 0; i < 5; i++) {
    tokens[`t${i}`] = counted(`Five${i}`);
  }

  let ctx;
  const { GET } = Route(tokens).get((context) => {
    ctx = context;
    return null;
  });
  await GET(await request(), payload());

  const keys = Object.keys(ctx);
  /* Checked one at a time, by both presence and class identity — a table of
     N=1 (or a bare `.length === 5`) cannot tell "all five" apart from "five
     things, wrong ones swapped in", and cannot tell "dropped the first" apart
     from "dropped the last". `t4` here is deliberately the boundary case: a
     `.slice(0, -1)` mutant passes every check up to i=3 and only dies at i=4. */
  for (let i = 0; i < 5; i++) {
    const key = `t${i}`;
    assert.ok(keys.includes(key), `${key} is listed`);
    assert.ok(ctx[key] instanceof tokens[key], `${key} holds its own class's instance, not another token's`);
  }
});

test("a token named after one of Context's own properties still wins — `params` as a token name reads the token, not the route params", async () => {
  const ParamsToken = counted("ParamsToken");
  let ctx;

  const { GET } = Route({ params: ParamsToken }).get((context) => {
    ctx = context;
    return null;
  });
  await GET(await request(), { params: Promise.resolve({ id: "42" }) });

  /* Context's constructor assigns `this.params = params` (the route's own
     params) before calling defineTokens — a token declared under the same
     name has to run AFTER that to win. P7 moves defineTokens ahead of it,
     which would make this read back the route's `{ id: "42" }` instead. */
  assert.ok(ctx.params instanceof ParamsToken, "the token wins over Context's own `params` field");
  assert.equal(ctx.params.id, "ParamsToken#1");
});

test("a handler may overwrite `ctx.db`, and the overwrite is local to that request — the next context reads the token again", async () => {
  const Db = counted("Db");
  const sentinel = { fake: true };

  /* Before 0064, this threw under ESM/strict — 2.0.0's own accessor has no
     setter, and v3's getter-on-prototype is the same shape. Assigning
     straight onto an own data property accepts the write instead (0064
     §3.7); that is a real behaviour change from both released versions, so
     it gets its own name and its own CHANGELOG line, not a silent pass. */
  const { GET } = Route({ db: Db }).get((ctx) => {
    ctx.db = sentinel;
    return ctx.db === sentinel;
  });
  const first = await GET(await request(), payload());
  assert.equal((await first.json()).data, true, "the overwrite is accepted, not thrown");

  let capturedCtx;
  const { GET: GET2 } = Route({ db: Db }).get((ctx) => {
    capturedCtx = ctx;
    return null;
  });
  await GET2(await request(), payload());

  assert.ok(capturedCtx.db instanceof Db, "a fresh context reads the token again");
  assert.notEqual(capturedCtx.db, sentinel, "the overwrite from the request before did not leak into this one");
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

/* Route's own version of this test lives just above. §6.3 of task 0064 moves
   `new Context(...)` inside the try in BOTH route.ts and proxy.ts — two
   files, same shape, same reason — and the task calls out explicitly that a
   Route-only test would leave that asymmetric: fixing one file and testing
   only it is exactly the kind of gap the house rule "vá một trục thì quét
   các trục cùng hình" warns about. This is the Gateway side of the same
   claim. */
test("a token whose constructor throws during a Gateway's context also reaches the gateway's own catch, not an unhandled rejection", async () => {
  let attempts = 0;
  class Flaky {
    constructor() {
      attempts++;
      if (attempts === 1) throw new Error("database not up yet");
    }
  }

  const gw = Gateway({ flaky: Flaky });

  const first = await quiet(async () => gw(await request(), payload()));
  assert.equal(first.status, 500);
  assert.equal((await first.json()).error, "Internal Server Error");

  const second = await gw(await request(), payload());
  assert.equal(second.headers.get("x-middleware-next"), "1", "the second request, with a cached Flaky, continues normally");

  assert.equal(attempts, 2, "the failed first attempt cached nothing — same rule as the Route side");
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

test("Gateway: a middleware returning a Response stops the chain, otherwise it continues", async () => {
  const blocked = await Gateway({}).use(() => new Response("no", { status: 401 }))(await request("/page"), payload());
  assert.equal(blocked.status, 401);

  const passed = await Gateway({}).use(() => {})(await request("/page"), payload());
  assert.equal(passed.headers.get("x-middleware-next"), "1");
});
