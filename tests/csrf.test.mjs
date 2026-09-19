/* Net under `src/csrf.ts`, task 0025. The file was copied from
   `release/1.1.0` verbatim except for the `SessionPort` → `IdentityPort`
   rename (six named spots, per the task) and a docblock. Everything below
   hunts a counter-example to one of the task's "KHÔNG BAO GIỜ" promises —
   most tests are unit-level against the two exported functions directly;
   §6 goes through `dist` with a real Gateway and a real Route, because a
   contract mismatch between `csrf.ts` and `exception.ts` is exactly the
   kind of thing that has slipped past unit tests before in this repo.

   Fake `CsrfPort`/`IdentityPort` classes are built fresh per test by the two
   factories below, so call counts and captured arguments never leak between
   tests — each factory attaches its counters as STATIC properties on the
   class it returns, read straight off the class after the fact. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { csrfOrigin, csrfGuard, Gateway, Route } = require("../dist/index.js");
const { NextRequest } = require("next/server");
const { reset } = require("./support/next-headers.cjs");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = (path = "/api/x") => `http://localhost${path}`;
const payload = () => ({ params: Promise.resolve({}) });

/** A fake `CsrfPort` class, fresh per call — `constructCount`, `originCalls`
 *  and `checkCalls` live as statics on the class itself, so a test reads
 *  `Csrf.constructCount` etc. straight off the value `makeCsrfClass`
 *  returned, with no shared module-level state to reset between tests. */
function makeCsrfClass({ origin = () => true, check = async () => true } = {}) {
  class Csrf {
    constructor() {
      Csrf.constructCount++;
    }
    origin(req) {
      Csrf.originCalls.push(req);
      return origin(req);
    }
    check(req, options) {
      Csrf.checkCalls.push({ req, options });
      return check(req, options);
    }
  }
  Csrf.constructCount = 0;
  Csrf.originCalls = [];
  Csrf.checkCalls = [];
  return Csrf;
}

/** A fake `IdentityPort` class, same fresh-per-call shape as `makeCsrfClass`. */
function makeIdentityClass({ id = "user-1" } = {}) {
  class Identity {
    constructor() {
      Identity.constructCount++;
    }
    load(jar) {
      Identity.loadCalls.push(jar);
      return Promise.resolve({ id });
    }
  }
  Identity.constructCount = 0;
  Identity.loadCalls = [];
  return Identity;
}

/** A minimal context: `{ req, setHeader }`, satisfying both `{ req: Request }`
 *  (what `csrfOrigin`/`csrfGuard` are typed against) and `CookieForwarding`
 *  (what `csrfGuard` casts to when it builds a jar for `identity.load`). */
function fakeContext(reqOverrides = {}) {
  const setHeaderCalls = [];
  return {
    req: { headers: new Headers(), ...reqOverrides },
    setHeaderCalls,
    setHeader(name, value) {
      setHeaderCalls.push([name, value]);
    },
  };
}

/* ---------------------------------------------------------------------- */
/* 0. The old name never surfaces — TypeScript cannot catch a docblock or   */
/*    an error string, so this hunts both directly.                        */
/* ---------------------------------------------------------------------- */

test("dist/csrf.d.ts declares IdentityPort and never declares SessionPort", () => {
  const dts = readFileSync(join(repoRoot, "dist", "csrf.d.ts"), "utf8");
  assert.match(dts, /interface IdentityPort/, "the public .d.ts must declare IdentityPort");
  assert.doesNotMatch(dts, /SessionPort/, "the public .d.ts must not mention SessionPort anywhere — not in a type, not in a comment");
});

test("no file under dist/ contains the string \"SessionPort\" — catches a leftover in a docblock, which TypeScript's type checker never looks at", () => {
  const distDir = join(repoRoot, "dist");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (readFileSync(full, "utf8").includes("SessionPort")) offenders.push(full);
    }
  };
  walk(distDir);
  assert.deepEqual(offenders, [], `"SessionPort" found in: ${offenders.join(", ")}`);
});

test("csrfGuard(C, {}) throws a TypeError whose message names `identity`, not `session`", () => {
  const Csrf = makeCsrfClass();
  assert.throws(
    () => csrfGuard(Csrf, {}),
    (err) => {
      assert.ok(err instanceof TypeError);
      assert.match(err.message, /identity/, "the error string is public API too — it must say `identity`");
      assert.doesNotMatch(err.message, /session/, "the error string must not still say `session` — that would point a caller at a key that no longer does anything");
      return true;
    },
  );
});

test("csrfGuard(C, { identity }) builds a middleware without throwing, and a plain object carrying only the OLD `session` key does not satisfy the guard — it still falls into the TypeError branch", () => {
  const Csrf = makeCsrfClass();
  const Identity = makeIdentityClass();

  assert.doesNotThrow(() => csrfGuard(Csrf, { identity: Identity }), "the new key must actually work at runtime, not just typecheck");

  // `{ session: Identity }` is exactly the 1.1.0 shape. TypeScript would
  // reject it today (no `session` key on CsrfGuardOptions), but this test
  // proves the RUNTIME agrees too — a caller who ignored the type error, or
  // a plain-JS caller (this package ships JS; nothing stops one), gets the
  // same construction-time throw as passing `{}`, not a silently-ignored key.
  assert.throws(
    () => csrfGuard(Csrf, { session: Identity }),
    TypeError,
    "an options object with only the old `session` key must be treated as having neither `bind` nor `identity` — the old key must be truly dead, not just retyped",
  );
});

/* ---------------------------------------------------------------------- */
/* 1. csrfOrigin never lets through a request whose origin check fails.    */
/* ---------------------------------------------------------------------- */

test("csrfOrigin: origin() returning false throws Forbidden with errorCode csrf_origin and the default message; true passes through and the middleware returns undefined", async () => {
  const failing = makeCsrfClass({ origin: () => false });
  const middleware = csrfOrigin(failing);
  const ctx = fakeContext();

  assert.throws(
    () => middleware(ctx),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.error.errorCode, "csrf_origin");
      assert.equal(err.error.message, "Cross-site request refused");
      return true;
    },
  );

  const passing = makeCsrfClass({ origin: () => true });
  const result = csrfOrigin(passing)(fakeContext());
  assert.equal(result, undefined, "a passing origin check must not throw and must not return a Response — the middleware just falls through");
});

test("csrfOrigin: a custom message reaches the thrown Forbidden, and the errorCode stays csrf_origin regardless", () => {
  const failing = makeCsrfClass({ origin: () => false });
  const middleware = csrfOrigin(failing, "Nope, not from here");

  assert.throws(
    () => middleware(fakeContext()),
    (err) => {
      assert.equal(err.error.message, "Nope, not from here");
      assert.equal(err.error.errorCode, "csrf_origin");
      return true;
    },
  );
});

test("csrfOrigin: Csrf is constructed fresh on EVERY call, not once when the middleware is built — the token has to be stateless", () => {
  const Csrf = makeCsrfClass({ origin: () => true });
  const middleware = csrfOrigin(Csrf);

  middleware(fakeContext());
  middleware(fakeContext());
  middleware(fakeContext());

  assert.equal(Csrf.constructCount, 3, "one `new Csrf()` per call — a version built once outside the returned function would read 1 here regardless of how many times the middleware runs");
});

test("csrfOrigin: origin() receives context.req itself, not a copy or some other object", () => {
  const Csrf = makeCsrfClass({ origin: () => true });
  const ctx = fakeContext();

  csrfOrigin(Csrf)(ctx);

  assert.equal(Csrf.originCalls.length, 1);
  assert.strictEqual(Csrf.originCalls[0], ctx.req, "origin() must be called with exactly context.req — not `context`, not a clone");
});

/* ---------------------------------------------------------------------- */
/* 2. csrfGuard never constructs without `bind` or `identity`, and it       */
/*    throws at FACTORY time, not at request time.                         */
/* ---------------------------------------------------------------------- */

test("csrfGuard(C, {}) throws synchronously at the moment it is called — building the middleware, before any request exists", () => {
  const Csrf = makeCsrfClass();
  // A test that called the returned middleware first, then wrapped THAT
  // call in assert.throws, would stay green even if the throw moved inside
  // the middleware — the module-load-time crash a misconfigured app should
  // get would silently become a per-request 500 instead. Asserting on the
  // factory call itself is what pins the throw to construction time.
  assert.throws(() => csrfGuard(Csrf, {}), TypeError);
});

test("csrfGuard(C, { bind }) and csrfGuard(C, { identity }) both construct without throwing", () => {
  const Csrf = makeCsrfClass();
  const Identity = makeIdentityClass();
  assert.doesNotThrow(() => csrfGuard(Csrf, { bind: () => "x" }));
  assert.doesNotThrow(() => csrfGuard(Csrf, { identity: Identity }));
});

/* Reviewer 0025, added at the final gate. §1 pins "constructed fresh on
   EVERY call" for csrfOrigin; csrfGuard is the parallel path and the task's
   mutant list (item 2) never aimed at it, so nothing here read a
   construction count on this side. Measured: hoisting BOTH `new Csrf()` and
   `new options.identity!()` out of the returned middleware — the honest
   shape of that mistake, a middleware that allocates once and reuses —
   left the whole suite at 172/172 green. The middlewares of a Next app are
   built once at module load and then serve every request in the process for
   its whole life, so an instance hoisted up there is shared across users:
   any per-request state a real Csrf or identity keeps on `this` leaks from
   one request into the next, which is the single worst failure this file
   could have. That is why both counts are read here, not just Csrf's. */
test("csrfGuard: Csrf AND the identity class are both constructed fresh on EVERY request, not once when the middleware is built — the parallel of §1's promise, on the side §1 does not cover", async () => {
  const Csrf = makeCsrfClass({ check: async () => true });
  const Identity = makeIdentityClass();
  const middleware = csrfGuard(Csrf, { identity: Identity });

  await middleware(fakeContext());
  await middleware(fakeContext());
  await middleware(fakeContext());

  assert.equal(Csrf.constructCount, 3, "one `new Csrf()` per request — a version built once outside the returned function reads 1 here no matter how many requests run through it");
  assert.equal(Identity.constructCount, 3, "one `new identity()` per request, for the same reason");
});

/* ---------------------------------------------------------------------- */
/* 3. csrfGuard never lets a failing check() through, in any of the        */
/*    shapes check() can fail in.                                          */
/* ---------------------------------------------------------------------- */

test("csrfGuard: check() returning false throws Forbidden with errorCode csrf_token and the default message; true passes through with no throw", async () => {
  const failing = makeCsrfClass({ check: async () => false });
  const middleware = csrfGuard(failing, { bind: () => "b1" });

  await assert.rejects(
    () => middleware(fakeContext()),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.error.errorCode, "csrf_token");
      assert.equal(err.error.message, "Invalid CSRF token");
      return true;
    },
  );

  const passing = makeCsrfClass({ check: async () => true });
  await assert.doesNotReject(() => csrfGuard(passing, { bind: () => "b1" })(fakeContext()));
});

test("csrfGuard: a custom message reaches the thrown Forbidden", async () => {
  const failing = makeCsrfClass({ check: async () => false });
  const middleware = csrfGuard(failing, { bind: () => "b1", message: "Bad token, try again" });

  await assert.rejects(() => middleware(fakeContext()), (err) => {
    assert.equal(err.error.message, "Bad token, try again");
    return true;
  });
});

test("csrfGuard: check() is genuinely awaited — a Promise resolving to false still throws, it is never read as truthy while still pending", async () => {
  // A Promise object is truthy. If the implementation ever dropped the
  // `await` before `new Csrf().check(...)`, `ok` would be that pending
  // Promise, `!ok` would be `false`, and every request would sail through —
  // the worst possible failure mode for a security guard, and one that
  // would not show up at all in a test whose fake check() resolves
  // synchronously. Adding a real delay makes the unresolved-promise window
  // observable: if `await` is missing, this test's own `middleware(...)`
  // call resolves (or rejects for the wrong reason) before the timer even
  // fires, instead of waiting for it.
  const Csrf = makeCsrfClass({
    check: () => new Promise((resolve) => setTimeout(() => resolve(false), 5)),
  });
  const middleware = csrfGuard(Csrf, { bind: () => "b1" });

  await assert.rejects(() => middleware(fakeContext()), (err) => {
    assert.equal(err.error.errorCode, "csrf_token");
    return true;
  });
});

test("csrfGuard: purpose reaches check() even when the caller never passed one — it is present as `undefined`, not dropped from the options object", async () => {
  const Csrf = makeCsrfClass({ check: async () => true });
  await csrfGuard(Csrf, { bind: () => "b1" })(fakeContext());

  const { options } = Csrf.checkCalls[0];
  assert.ok(Object.hasOwn(options, "purpose"), "the `purpose` key must be present on the object passed to check(), even though its value is undefined — an implementation that only sets the key when purpose is truthy would fail this");
  assert.equal(options.purpose, undefined);

  const Csrf2 = makeCsrfClass({ check: async () => true });
  await csrfGuard(Csrf2, { bind: () => "b1", purpose: "reset-password" })(fakeContext());
  assert.equal(Csrf2.checkCalls[0].options.purpose, "reset-password");
});

test("csrfGuard: check() receives context.req and the bind value that was actually computed", async () => {
  const Csrf = makeCsrfClass({ check: async () => true });
  const ctx = fakeContext();
  await csrfGuard(Csrf, { bind: () => "computed-bind" })(ctx);

  const { req, options } = Csrf.checkCalls[0];
  assert.strictEqual(req, ctx.req);
  assert.equal(options.bind, "computed-bind");
});

/* ---------------------------------------------------------------------- */
/* 4. `bind` never loses to `identity` when both are given, and an empty   */
/*    string from `bind` is never treated as "absent".                     */
/* ---------------------------------------------------------------------- */

test("csrfGuard: only bind given — its return value is used, and no identity class exists to construct", async () => {
  const Csrf = makeCsrfClass({ check: async () => true });
  await csrfGuard(Csrf, { bind: () => "from-bind" })(fakeContext());
  assert.equal(Csrf.checkCalls[0].options.bind, "from-bind");
});

test("csrfGuard: only identity given — the id it loads is used as bind", async () => {
  reset();
  const Csrf = makeCsrfClass({ check: async () => true });
  const Identity = makeIdentityClass({ id: "id-from-identity" });
  await csrfGuard(Csrf, { identity: Identity })(fakeContext());

  assert.equal(Identity.constructCount, 1);
  assert.equal(Csrf.checkCalls[0].options.bind, "id-from-identity");
});

test("csrfGuard: both bind and identity given — bind wins, and identity's constructor never runs at all", async () => {
  reset();
  const Csrf = makeCsrfClass({ check: async () => true });
  const Identity = makeIdentityClass({ id: "should-not-be-used" });
  await csrfGuard(Csrf, { bind: () => "bind-wins", identity: Identity })(fakeContext());

  assert.equal(Csrf.checkCalls[0].options.bind, "bind-wins");
  assert.equal(Identity.constructCount, 0, "identity must never be constructed when bind is given — `new Identity()` running at all means the branch chose wrong even if the FINAL bind value happens to still look right");
});

test("csrfGuard: bind may be a synchronous function or an async one — both are used the same way", async () => {
  const Csrf = makeCsrfClass({ check: async () => true });
  await csrfGuard(Csrf, { bind: () => "sync-bind" })(fakeContext());
  assert.equal(Csrf.checkCalls[0].options.bind, "sync-bind");

  const Csrf2 = makeCsrfClass({ check: async () => true });
  await csrfGuard(Csrf2, { bind: async () => "async-bind" })(fakeContext());
  assert.equal(Csrf2.checkCalls[0].options.bind, "async-bind");
});

test("csrfGuard: bind resolving to an empty string is still used as the bind value — it does NOT fall back to identity", async () => {
  reset();
  const Csrf = makeCsrfClass({ check: async () => true });
  const Identity = makeIdentityClass({ id: "fallback-should-not-appear" });
  await csrfGuard(Csrf, { bind: async () => "", identity: Identity })(fakeContext());

  assert.equal(Csrf.checkCalls[0].options.bind, "", 'an empty string from bind() must reach check() as "" — a `||` or `??` on the AWAITED VALUE (rather than branching on whether options.bind itself was given) would treat "" as absent and read identity instead');
  assert.equal(Identity.constructCount, 0, "falling back to identity here would also mean identity got constructed, which must not happen");
});

test("csrfGuard: identity.load receives a jar with get/set/delete — the same shape cookieJar() always returns", async () => {
  reset();
  const Csrf = makeCsrfClass({ check: async () => true });
  const Identity = makeIdentityClass();
  await csrfGuard(Csrf, { identity: Identity })(fakeContext());

  assert.equal(Identity.loadCalls.length, 1);
  const jar = Identity.loadCalls[0];
  assert.equal(typeof jar.get, "function");
  assert.equal(typeof jar.set, "function");
  assert.equal(typeof jar.delete, "function");
});

/* ---------------------------------------------------------------------- */
/* 5. The Forbidden both middlewares throw becomes a real 403 through a    */
/*    real Gateway and a real Route — not just assert.throws on the raw fn.  */
/* ---------------------------------------------------------------------- */

test("0025 §6, end-to-end through dist: csrfOrigin turns a failing origin check into a 403 through a real Gateway, and lets a passing one through to the next middleware", async () => {
  const failing = makeCsrfClass({ origin: () => false });
  const proxyDenies = Gateway({}).use(csrfOrigin(failing));
  const denied = await proxyDenies(new NextRequest(url("/page")), payload());
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.errorCode, "csrf_origin");

  let reachedNext = false;
  const passing = makeCsrfClass({ origin: () => true });
  const proxyAllows = Gateway({}).use(csrfOrigin(passing), () => {
    reachedNext = true;
  });
  const allowed = await proxyAllows(new NextRequest(url("/page")), payload());
  assert.notEqual(allowed.status, 403);
  assert.ok(reachedNext, "a passing origin check must let the chain continue to the next middleware — this is the non-vacuous half of the test");
});

/* Building ANY Gateway — including the one in the test right above this one —
   flips a one-way, process-wide flag (Context.activateGateway(), via
   Memory.activateGateway() — see context.ts's own comment on it and
   house-rules on process-level one-way state). Once flipped, a bare
   Route(), called with no `x-ecosyrequest-id` header, throws "Missing
   'x-ecosyrequest-id' header" before csrfGuard's middleware ever runs — a
   failure this test hunted into existence on its first draft. Routing
   through a real (pass-through) Gateway first, exactly like
   `tests/cookie-jar.test.mjs`'s own §6, sidesteps the ordering dependency
   entirely: it is correct whether or not an earlier test in this file (or,
   for `node --test`'s one-process-per-file model, this file alone) already
   activated proxy mode. */
const FORWARDED_PREFIX = "x-middleware-request-";
function forwardedHeaders(response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name.startsWith(FORWARDED_PREFIX)) headers.set(name.slice(FORWARDED_PREFIX.length), value);
  }
  return headers;
}
const passthroughProxy = Gateway({}).use((ctx) => ctx.next());

test("0025 §6, end-to-end through dist: csrfGuard turns a failing check() into a 403 through a real Route, and lets a passing one through to the handler", async () => {
  reset();
  const failing = makeCsrfClass({ check: async () => false });
  const proxiedForDenied = await passthroughProxy(new NextRequest(url("/page")), payload());
  const { GET: deniedGet } = Route().use(csrfGuard(failing, { bind: () => "b" })).get(async () => "should not run");
  const denied = await deniedGet(new NextRequest(url(), { headers: forwardedHeaders(proxiedForDenied) }), payload());
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.errorCode, "csrf_token");

  reset();
  let handlerRan = false;
  const passing = makeCsrfClass({ check: async () => true });
  const proxiedForAllowed = await passthroughProxy(new NextRequest(url("/page")), payload());
  const { GET: allowedGet } = Route()
    .use(csrfGuard(passing, { bind: () => "b" }))
    .get(async () => {
      handlerRan = true;
      return "ok";
    });
  const allowed = await allowedGet(new NextRequest(url(), { headers: forwardedHeaders(proxiedForAllowed) }), payload());
  assert.notEqual(allowed.status, 403);
  assert.ok(handlerRan, "a passing check() must let the Route's handler actually run — this is the non-vacuous half of the test");
});
