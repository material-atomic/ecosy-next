/* Net under `src/cookie-jar.ts`, task 0024. The file was copied verbatim
   from `release/1.1.0` and shipped there with NO tests at all — this is the
   first time anyone has asked whether it is correct. Every test here hunts
   a counter-example to one of the six "KHÔNG BAO GIỜ" promises the task
   lists, not a happy path.

   `next/headers` is stubbed by `tests/support/next-headers.cjs`, resolved
   through `tests/hooks.mjs` the same way `server-only` already is. That
   stub's `get()` never reflects its own `set()` — see its own comment for
   why that is load-bearing, not an oversight. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cookieJar, Proxy, Route } = require("../dist/index.js");
const { NextRequest } = require("next/server");
const { reset, seed, sets } = require("./support/next-headers.cjs");

const url = (path = "/api/x") => `http://localhost${path}`;
const payload = () => ({ params: Promise.resolve({}) });
const FORWARDED_PREFIX = "x-middleware-request-";

/** The request headers a proxy response forwards, as Next reads them —
 *  same helper as request-id.test.mjs and context.test.mjs. */
function forwarded(response) {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (name.startsWith(FORWARDED_PREFIX)) headers.set(name.slice(FORWARDED_PREFIX.length), value);
  }
  return headers;
}

/** A minimal `CookieForwarding`: just `req.headers.get("cookie")` and a
 *  `setHeader` a test can spy on. `Context` satisfies the same shape (that
 *  is §6's job, further down) — this one exists so §§1-5 can test the jar
 *  on its own, without a whole Proxy/Route round trip in the way. */
function fakeForwarding(cookieHeader, calls = []) {
  return {
    req: { headers: new Headers(cookieHeader != null ? { cookie: cookieHeader } : {}) },
    calls,
    setHeader(name, value) {
      calls.push([name, value]);
    },
  };
}

/* ---------------------------------------------------------------------- */
/* 1. A value just written is NEVER shadowed by the request's own value,   */
/*    in every write/delete order the task names.                         */
/* ---------------------------------------------------------------------- */

test("within one jar, a value just written is read back at once, in every write/delete order named by the task — set beats the request's own value, a second write beats the first, delete then get is null, and a delete can be reversed by writing again", async () => {
  reset();
  seed({ sid: "request-value" });
  const jar = await cookieJar();

  await jar.set("sid", "written-1", {});
  assert.equal(jar.get("sid"), "written-1", "set() overwriting a cookie the request already had must read back the NEW value, not the request's");

  await jar.set("sid", "written-2", {});
  assert.equal(jar.get("sid"), "written-2", "writing the same name twice in one jar: the later write wins");

  await jar.delete("sid", {});
  assert.equal(jar.get("sid"), null, "delete then get is null");

  await jar.set("sid", "written-3", {});
  assert.equal(jar.get("sid"), "written-3", "delete then set again then get must return the new value, not stay null and not fall back to the request's original value");

  await jar.delete("sid", {});
  assert.equal(jar.get("sid"), null, "set then delete then get is null");
});

/* ---------------------------------------------------------------------- */
/* 2. get() returns EXACTLY what the code returns: null for unknown,      */
/*    the request's value when untouched, "" kept as "" (not coerced to   */
/*    null — `?? null` only catches null/undefined), and names are        */
/*    case-sensitive.                                                      */
/* ---------------------------------------------------------------------- */

test("get() is exactly `written.has ? written.get : store.get(name)?.value ?? null` — unknown is null, an untouched request cookie is its own value, an empty-string request cookie stays empty (not null), and cookie names are case-sensitive", async () => {
  reset();
  seed({ known: "kv", empty: "" });
  const jar = await cookieJar();

  assert.equal(jar.get("unknown-name"), null, "a cookie never seen anywhere is null");
  assert.equal(jar.get("known"), "kv", "a cookie only present in the request returns its value, untouched");
  assert.equal(jar.get("empty"), "", 'an empty-string request cookie must stay "" — `?? null` only catches null/undefined, and "" is neither');
  assert.equal(jar.get("Known"), null, "a different-case name is a different cookie — get() must not case-fold");
});

/* ---------------------------------------------------------------------- */
/* 3. serialiseCookieHeader never corrupts a request's existing cookies.   */
/*    A table, one axis per row, per house-rules on universal claims —    */
/*    eleven rows, matching the task's own enumeration exactly.           */
/* ---------------------------------------------------------------------- */

/* Every row triggers exactly one op through a fresh jar/forwarding pair,
   then reads the LAST call `setHeader("cookie", ...)` received — forward()
   recomputes the full header from the cumulative `written` map every time,
   so the last call already reflects every op in the row. Each `expected`
   value below was hand-traced against the real algorithm (indexOf + slice,
   not split("=")) before being written down — see the Kết quả table for
   that trace. */
const SERIALISE_ROWS = [
  {
    axis: "no cookie header on the request at all",
    original: null,
    ops: [["set", "new", "v1"]],
    expected: "new=v1",
  },
  {
    axis: "one cookie already present, write another — both present, old keeps its position before new",
    original: "old=1",
    ops: [["set", "new", "v2"]],
    expected: "old=1; new=v2",
  },
  {
    axis: "whitespace around ';' and '=' — nothing lost, nothing carries extra whitespace",
    original: "  a = 1 ;  b = 2  ",
    ops: [["set", "c", "3"]],
    expected: "a=1; b=2; c=3",
  },
  {
    axis: "a cookie value that itself contains '=' — value is everything after the FIRST '=', not split(\"=\")[1]",
    original: "a=b=c",
    ops: [["set", "y", "1"]],
    expected: "a=b=c; y=1",
  },
  {
    axis: "an empty part between two ';' — skipped, the other two survive",
    original: "a=1;;b=2",
    ops: [["set", "c", "3"]],
    expected: "a=1; b=2; c=3",
  },
  {
    axis: "a part with no '=' at all (a bare flag) — skipped",
    original: "a=1; flag; b=2",
    ops: [["set", "c", "3"]],
    expected: "a=1; b=2; c=3",
  },
  {
    axis: "a part starting with '=' (eq === 0, caught by eq <= 0, not eq < 0) — skipped",
    original: "=x; a=1",
    ops: [["set", "c", "3"]],
    expected: "a=1; c=3",
  },
  {
    axis: "delete a cookie present in the request — it disappears from the output",
    original: "a=1; b=2",
    ops: [["delete", "a"]],
    expected: "b=2",
  },
  {
    axis: "delete a cookie NOT present in the request — output is unchanged, no stray empty entry",
    original: "a=1",
    ops: [["delete", "nope"]],
    expected: "a=1",
  },
  {
    axis: "overwrite a cookie already present — appears once, at its OLD position, not appended at the end",
    original: "a=1; b=2",
    ops: [["set", "a", "99"]],
    expected: "a=99; b=2",
  },
  {
    axis: "deleting the middle cookie of three leaves the other two in their original order, no gap",
    original: "a=1; b=2; c=3",
    ops: [["delete", "b"]],
    expected: "a=1; c=3",
  },
];

test("serialiseCookieHeader: a table of eleven cases, one axis different per row, all matching the task's own enumeration of what forward() must never corrupt", async () => {
  for (const { axis, original, ops, expected } of SERIALISE_ROWS) {
    reset();
    const forwarding = fakeForwarding(original);
    const jar = await cookieJar(forwarding);

    for (const [kind, name, value] of ops) {
      if (kind === "set") await jar.set(name, value, {});
      else await jar.delete(name, {});
    }

    const last = forwarding.calls.at(-1);
    assert.ok(last, `axis "${axis}": setHeader was never called`);
    assert.equal(last[0], "cookie", `axis "${axis}": setHeader must be called with "cookie" as the header name`);
    assert.equal(last[1], expected, `axis "${axis}"`);
  }
});

/* Self-check, per house-rules "phải NỚI, không chỉ THU HẸP": the table above
   only ever tests eq positions 0 and 1 relative to the start of a part. One
   deliberately OUTSIDE that — an '=' several characters in, on a part that
   itself starts with whitespace this file's own .trim() has to eat AFTER
   finding eq, not before — to make sure the boundary rows above aren't
   quietly relying on eq landing at the very start of the (untrimmed) part. */
test("serialiseCookieHeader self-check: an '=' several characters into a whitespace-padded part is still parsed correctly — not just the eq-at-position-0/1 cases the table above happens to hit", async () => {
  reset();
  const forwarding = fakeForwarding("   longname   =   longvalue   ; kept=1");
  const jar = await cookieJar(forwarding);
  await jar.set("z", "9", {});

  assert.equal(forwarding.calls.at(-1)[1], "longname=longvalue; kept=1; z=9");
});

/* `CookieJar.set`'s own type says `value: string` — but that is a
   compile-time contract only. The compiled JS this suite actually runs
   enforces nothing, and `value === null` (checked to decide "was this a
   delete?") and `value == null` (loose equality, also true for
   `undefined`) agree on every input `written` can hold UNDER the type —
   `string | null` — which is exactly why task mutation 16a
   (`value === null` → `value == null`) survived the eleven-row table
   above: nothing in that table ever puts `undefined` into `written`. A
   caller that slips past TypeScript (or, same thing, a plain JS caller —
   this package ships JS, and nothing at runtime stops it) and calls
   `set(name, undefined, {})` is the one input where the two comparisons
   disagree: `undefined === null` is false (falls to `pairs.set`, matching
   real Next's own `${name}=${value}` coercion to the string "undefined"),
   `undefined == null` is true (falls to `pairs.delete`, silently dropping
   the cookie instead). Recorded here rather than deemed unobservable,
   because it IS observable — just not through the typed contract alone. */
test("serialiseCookieHeader treats an explicit set(name, undefined, {}) as a write, not a delete — value === null and value == null disagree on undefined, and only the strict form matches what set()'s own template-literal serialisation actually produces", async () => {
  reset();
  const forwarding = fakeForwarding("kept=1");
  const jar = await cookieJar(forwarding);
  await jar.set("x", undefined, {});

  assert.equal(
    forwarding.calls.at(-1)[1],
    "kept=1; x=undefined",
    'an explicit undefined must serialise as the literal "undefined" (matching plain string coercion in the template literal), not vanish as if delete() had been called',
  );
});

/* ---------------------------------------------------------------------- */
/* 4. Without a `forwarding` argument, setHeader is NEVER called.          */
/* ---------------------------------------------------------------------- */

test("await cookieJar() with no argument (the route-handler shape) never calls setHeader on set() or delete() — neither a fake forwarding object built but never passed, nor a throw, gives it away", async () => {
  reset();
  const spy = fakeForwarding(null);
  const jar = await cookieJar(); // forwarding NOT passed to cookieJar() at all

  await jar.set("a", "1", {});
  await jar.delete("b", {});

  assert.equal(spy.calls.length, 0, "a forwarding object that was never handed to cookieJar() must never see a call — proves nothing reaches for it by surprise");
  /* The other half of this promise: if `if (!forwarding) return;` were
     removed (task mutation 9), `forward()` would call `undefined.setHeader`
     and this test's set()/delete() calls above would already have thrown —
     node:test fails a test on an unhandled rejection, so reaching this line
     at all is itself part of the proof. */
});

test("passing forwarding makes set() call setHeader exactly once, and delete() exactly one more time after that", async () => {
  reset();
  const forwarding = fakeForwarding(null);
  const jar = await cookieJar(forwarding);

  await jar.set("a", "1", {});
  assert.equal(forwarding.calls.length, 1, "set() must call setHeader exactly once");

  await jar.delete("a", {});
  assert.equal(forwarding.calls.length, 2, "delete() must call setHeader exactly one more time — not zero, not two more");
});

/* ---------------------------------------------------------------------- */
/* 5. delete() ALWAYS sets maxAge: 0, and every other option passes        */
/*    through unchanged — even a caller-supplied maxAge is overwritten.    */
/* ---------------------------------------------------------------------- */

test("delete() always writes maxAge: 0 to the underlying store, and passes every other option through unchanged, overriding even a caller-supplied maxAge", async () => {
  reset();
  const forwarding = fakeForwarding(null);
  const jar = await cookieJar(forwarding);

  await jar.delete("sid", { path: "/app", domain: "example.com", sameSite: "strict", secure: true, httpOnly: true });
  let last = sets().at(-1);
  assert.equal(last.name, "sid");
  assert.equal(last.value, "", "delete() writes an empty string, not the cookie's old value");
  assert.deepEqual(
    last.options,
    { path: "/app", domain: "example.com", sameSite: "strict", secure: true, httpOnly: true, maxAge: 0 },
    "every option the caller passed must survive untouched, alongside maxAge forced to 0",
  );

  await jar.delete("sid2", { maxAge: 3600 });
  last = sets().at(-1);
  assert.equal(last.options.maxAge, 0, "a caller-supplied maxAge for delete() must be overwritten to 0, never respected — {...options, maxAge: 0} order matters");
  assert.deepEqual(Object.keys(last.options), ["maxAge"], "no other option leaks in when the caller passed none");
});

/* 0024 Reviewer picked two mutants in set() and both survived 145/145 green:
   deleting the `store.set(name, value, options)` line outright (cookies
   would go into `written` — so get()/forward() still looked right — but the
   response would never carry a Set-Cookie at all), and downgrading its
   third argument to `{}` (httpOnly/secure/sameSite/path silently dropped,
   shipping the session cookie bare). Both survived because §5 above reads
   `sets()` for delete()'s write to the store and nothing anywhere read
   `sets()` for set()'s — the equivalent path, touched more often by callers,
   had no assertion on the one place where dropping the call or the options
   is actually observable. This is that assertion, mirroring §5 exactly. */
test("set() always writes the caller's name, value and EVERY option to the underlying store — unabbreviated, and the call itself is never skipped", async () => {
  reset();
  const forwarding = fakeForwarding(null);
  const jar = await cookieJar(forwarding);

  await jar.set("sid", "abc", { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
  let last = sets().at(-1);
  assert.ok(last, "store.set() must actually be called — written()/forward() alone are not enough: a browser only gets Set-Cookie from this call");
  assert.equal(last.name, "sid");
  assert.equal(last.value, "abc");
  assert.deepEqual(
    last.options,
    { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
    "every option the caller passed to set() must reach the underlying store untouched — downgrading to {} would silently strip httpOnly/secure/sameSite/path from the Set-Cookie the browser receives, with get()/forward() both still looking correct since neither reads from the store",
  );

  await jar.set("sid2", "v2", {});
  last = sets().at(-1);
  assert.deepEqual(Object.keys(last.options), [], "an empty options object passed by the caller must reach the store as empty, not spuriously gain keys");
});

/* ---------------------------------------------------------------------- */
/* 6. The proxy→route chain never drops a cookie, at EITHER way a          */
/*    middleware can end — the whole reason this task sits after 0023.     */
/* ---------------------------------------------------------------------- */

/** What real Next's own `cookies()` does automatically — parse the ambient
 *  request's `Cookie` header into its per-request store — is NOT part of
 *  this package, and the stub can't do it either (it has no request to be
 *  "ambient" to; `cookies()` takes no argument, same as the real one). The
 *  test does that one step of parsing by hand, right before calling the
 *  Route, to stand in for what Next itself would have already done by the
 *  time a real route handler's `cookies()` runs. */
function parseCookieHeader(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

async function runProxyThenRoute(middleware) {
  reset();
  const proxy = Proxy({}).use(middleware);
  const proxied = await proxy(new NextRequest(url("/page")), payload());
  const nextHeaders = forwarded(proxied);

  reset();
  seed(parseCookieHeader(nextHeaders.get("cookie")));
  const { GET } = Route().get(async (ctx) => (await cookieJar()).get("sid") ?? null);
  const res = await GET(new NextRequest(url(), { headers: nextHeaders }), payload());
  return { data: (await res.json()).data, cookieHeader: nextHeaders.get("cookie") };
}

test("0024 §6, end-to-end through dist: cookieJar(ctx).set(\"sid\", \"abc\", {}) in a Proxy middleware is read back as \"abc\" via cookieJar() in the Route, for BOTH ways a middleware can end — this is the promise 0023 bought and this task stands on", async () => {
  const withReturn = async (ctx) => {
    const jar = await cookieJar(ctx);
    await jar.set("sid", "abc", {});
    return ctx.next();
  };
  const withoutReturn = async (ctx) => {
    const jar = await cookieJar(ctx);
    await jar.set("sid", "abc", {});
    // no return at all — falls through to proxy.ts's own context.res.next(context.init)
  };

  const a = await runProxyThenRoute(withReturn);
  const b = await runProxyThenRoute(withoutReturn);

  assert.equal(a.data, "abc", "`return ctx.next();` must let the Route read the cookie the Proxy set");
  assert.equal(b.data, "abc", "no return at all must let the Route read the SAME cookie — this is exactly what 0023 fixed");
  assert.equal(a.cookieHeader, b.cookieHeader, "both endings must forward the identical cookie header — not just an identical outcome after re-parsing it");
});

/* ---------------------------------------------------------------------- */
/* 7. Two independently-built jars never share state — the reason         */
/*    `written = new Map()` must live inside cookieJar(), not at module    */
/*    scope (task mutation 20).                                            */
/* ---------------------------------------------------------------------- */

test("two separate cookieJar() calls each get their OWN written overlay — a second jar's get() never sees the first jar's write, unless that name was also a real request cookie", async () => {
  reset();
  const jar1 = await cookieJar();
  await jar1.set("other", "from-jar-1", {});
  assert.equal(jar1.get("other"), "from-jar-1", "sanity: jar1 sees its own write");

  const jar2 = await cookieJar();
  assert.equal(
    jar2.get("other"),
    null,
    "a second, independently-built jar must not see the first jar's write — if `written` were a single Map shared at module scope, jar2 would read jar1's value here",
  );
});
