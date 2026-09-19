import { NextRequest } from "next/server";
import { InjectMap, MiddlewareResponseInit, LiteralObject } from "./types";
import { createUrl, UrlOptions } from "./url";
import { Res } from "./res";
import { Cookie } from "./cookie";
import { NextURL } from "next/dist/server/web/next-url";
import { defineTokens } from "./container";
import { REQUEST_ID, RequestStore } from "./request-store";

const MEMORY_KEY = Symbol.for("@ECOSY/CONTEXT_MEMORY");
const PROXY_KEY = Symbol.for("@ECOSY/CONTEXT_PROXY");

/* Every key a caller gives to Context.set() goes into the bag under this
   prefix, not under its own name. A key named `__proto__` assigned straight
   into an object writes the object's prototype, not a stored key — and
   Object.prototype has no property starting with `$` (constructor,
   hasOwnProperty, isPrototypeOf, propertyIsEnumerable, toLocaleString,
   toString, valueOf, __proto__, __defineGetter__, __defineSetter__,
   __lookupGetter__, __lookupSetter__ — none of them), so the prefix turns
   that whole class of key into an ordinary own property. Added at EXACTLY
   this layer: a key that has passed through RequestStore already carries the
   prefix, so RequestStore.write's own `values[key] = value` stays safe with
   no change of its own.
   0023 adds a second place this prefix gets applied: the constructor
   normalizes any bare key already sitting in a hand-built `local` bag before
   `this.values` is ever assigned (see the loop there). That is the ONLY other
   writer of the prefix — `get`/`set` still do it exactly as before, and
   nothing below reads a name without it.
   The warning that belongs here for whoever adds a fifth: every future API
   that touches the bag has to cross this prefix, and the direction it crosses
   in decides what it has to do.
   - A name going OUT to a caller must have the prefix STRIPPED: `keys()`,
     `entries()`, anything an app would reach for to see what a proxy handed
     it. `destroy()` today is safe with none of that stripping only because it
     deletes every own key without ever reading what any of them are named; a
     `keys()` written the same "don't read the name" way would leak `$userId`
     straight to a caller who only ever wrote or asked for `userId`.
   - A name coming IN from a caller must have the prefix ADDED, exactly the
     way `set` and `get` below already do it: a `has(name)` must ask about
     `KEY_PREFIX + name`, never about `name`. Getting this one backwards is
     quieter than the other — `has("userId")` would simply answer `false`
     forever, for a key that is sitting right there.
   None of those three is written in this task — see ContextValues and the
   constructor's normalization loop below for why. */
const KEY_PREFIX = "$";

const _global = globalThis as (typeof globalThis & {
  [MEMORY_KEY]: Map<string, any>;
})

if (!_global[MEMORY_KEY]) {
  _global[MEMORY_KEY] = new Map();
}

const memory = _global[MEMORY_KEY];

/**
 * A process-wide key/value store, held on `globalThis` under a `Symbol.for` key
 * so a hot reload re-uses the same Map instead of starting a second one.
 *
 * What a {@link Gateway} hands to a {@link Route} does not live here: it goes
 * through a store of its own, bounded and keyed by a signed request id.
 */
export class Memory {
  /**
   * Reads a value.
   *
   * @param key - Storage key.
   * @returns The value, or `undefined` when the key is unset.
   */
  static get<DataType>(key: string) {
    return memory.get(key) as DataType | undefined;
  }

  /**
   * Writes a value.
   *
   * @param key - Storage key.
   * @param value - Value to store.
   * @returns The value, for chaining.
   */
  static set<DataType>(key: string, value: DataType) {
    memory.set(key, value);
    return value;
  }

  /**
   * Drops a key if present.
   *
   * @param key - Storage key.
   */
  static remove(key: string) {
    if (memory.has(key)) {
      memory.delete(key);
    }
  }

  /**
   * Marks the app as proxied, which makes {@link Route} demand the
   * `x-ecosyrequest-id` header on every request — turning "this route was
   * reachable without middleware" into an error at the boundary.
   *
   * The flag is defined non-writable and non-configurable, so it is one-way for
   * the life of the process.
   */
  static activateGateway() {
    if (!(globalThis as any)[PROXY_KEY]) {
      Object.defineProperty(globalThis, PROXY_KEY, {
        value: true,
        writable: false,
        configurable: false,
      });
    }
  }

  /** Whether {@link Memory.activateGateway} has been called. */
  static get isGatewayActivated() {
    return !!(globalThis as any)[PROXY_KEY];
  }
}

/** {@link UrlOptions} without `base`, which {@link Context.uri} supplies. */
export type BaseUrlOptions = Omit<UrlOptions, "base">;

/**
 * Where a context keeps what {@link Context.set} stores. {@link Gateway} and
 * {@link Route} choose it; a context built by hand keeps its own.
 *
 * - `shared`: written under a signed request id, for the route serving the same
 *   request to take — a Gateway's context.
 * - `local`: held on the context itself — a Route's, starting from whatever the
 *   proxy handed over.
 *
 * The `local` branch used to carry an unchecked invariant: every key already
 * inside it was *supposed* to already carry {@link Context}'s `$` prefix,
 * because the only two things this constructor argument was ever meant to
 * receive on that branch are `RequestStore.claim()`'s return value — already
 * prefixed, since it only ever holds what `Context.set` wrote — or the
 * literal `{}` default. Constructing a `Context` by hand with a `local` bag
 * that already had bare (unprefixed) keys in it was a fourth way into the
 * bag: a seeded `{ local: { userId: "u1" } }` sat under the bare name
 * `userId`, but `get("userId")` only ever looks under `$userId` — so the seed
 * was invisible from the first read, not stuck.
 *
 * 0023 turns that invariant into something the constructor actually makes
 * true instead of only hoping for: any bare key it finds in `local` is given
 * the `$` prefix in place, once, before `this.values` is assigned — see the
 * normalization loop in the constructor. So today a hand-built
 * `{ local: { userId: "u1" } }` reads back correctly (`get("userId") ===
 * "u1"`). Two rules go with that, both decided in favour of the only valid
 * source (`RequestStore.claim()`, whose keys are already prefixed): a key that
 * already starts with `$` is left alone — `{ "$a": 1 }` means the key `a`, not
 * a literal `$a` — and when both forms are present (`{ userId: "u1",
 * $userId: "u2" }`) the prefixed one wins and the bare one is dropped.
 *
 * The renaming happens on the object you passed in, not on a copy — see that
 * loop's comment for why. Two consequences for a caller that keeps its own
 * reference to the seed:
 *
 * - That object's own keys change under it: `userId` becomes `$userId`.
 * - A seed object is not reusable. `this.values` holds the object itself, so
 *   two contexts built from the same seed share one bag for their whole life:
 *   `a.set(...)` is readable through `b.get(...)`, and `a.destroy()` empties
 *   the bag `b` is still using. That has always been true of this argument and
 *   is not checked at runtime; before, a seeded value was invisible anyway, so
 *   nobody had a reason to hold on to one. Now that it reads back, build a
 *   fresh object per context.
 */
export type ContextValues = { shared: string } | { local: Record<string, unknown> };

/**
 * The request context handed to every route handler and middleware — the
 * request itself, its parsed URL and params, response constructors, cookie
 * access, and a per-request bag of values.
 *
 * A context is built per request; its injected dependencies are not. Each is
 * an own property holding its token's shared instance, resolved eagerly while
 * this constructor runs and typed through {@link Injected}. Shared per class,
 * and a class is one per module graph that evaluates it — Next compiles
 * instrumentation, the gateway, route handlers and pages separately — so it
 * is one per process only for a class anchored with `@ecosy/anchor`.
 *
 * @template Env - The shape of `process.env` this app expects.
 */
export class Context<Env extends LiteralObject = LiteralObject> {
  readonly req: NextRequest;
  readonly url: URL;
  readonly init: Required<MiddlewareResponseInit>;
  readonly params: Record<string, string | string[]>;

  readonly res = Res;
  readonly cookie = Cookie;

  private readonly values: ContextValues;

  /**
   * @param req - The incoming request.
   * @param params - Route params, already resolved.
   * @param injects - Tokens to put on the context. Every one is resolved and
   * assigned before the constructor returns.
   * @param values - Where `set` keeps values. See {@link ContextValues}.
   */
  constructor(
    req: NextRequest,
    params: Record<string, string | string[]>,
    injects?: InjectMap,
    values: ContextValues = { local: {} },
  ) {
    this.req = req;
    this.url = new URL(req.url);
    this.init = {
      request: {
        headers: new Headers(req.headers)
      },
    } as Required<MiddlewareResponseInit>;
    this.params = params;

    if (injects) {
      defineTokens(this, injects);
    }

    /* 0023: the fourth way into the bag (see ContextValues above) is a `local`
       value handed to this constructor with bare keys already in it — a
       Route or a Gateway never does that, but a caller building a `Context` by
       hand for a test does, and nothing before this loop stopped it. Only
       `local` is touched; `shared` values live in RequestStore under keys
       `Context.set` already prefixed on the way in, so there is nothing to
       normalize there, and reaching for `values.local` when only `shared` was
       given would throw on `Object.entries(undefined)` — the guard below is
       load-bearing, not decorative.

       Four things this loop does on purpose, each one a place an earlier
       draft got wrong:
       - `Object.entries`, not `for...in` — only OWN enumerable keys. A bag
         built with `Object.create(someProto)` must not pull an inherited key
         off its prototype into the bag as if the caller had set it.
       - A key that already starts with `$` is left alone. The only valid
         source for a `local` value is `RequestStore.claim()`, which only ever
         returns what `Context.set` wrote — already prefixed — so a key
         arriving with `$` on it is trusted, not re-prefixed. One consequence
         worth being explicit about: a seed of `{ "$a": 1 }` is read as "the
         key `a`, already prefixed", not as "the literal key `$a`" — there is
         no way to tell those two intentions apart from the string alone, and
         the valid source only ever means the first.
       - When both a bare key and its prefixed form are present in the same
         bag (`{ userId: "u1", $userId: "u2" }`), the prefixed one wins and the
         bare one is dropped. Same reasoning: the prefixed value is the one
         that could have come from the valid source, so it is treated as the
         newer, authoritative write.
       - The rewrite happens on `values.local` itself, in place — not on a
         copy. `destroy()` deletes every own key off the exact object
         `this.values.local` points to; normalizing a copy would leave
         `this.values.local` pointing at the original while `destroy()` (and
         everything else) sees the copy, silently splitting the bag in two.
         The price of "in place" is observable on purpose: a caller that kept
         its own reference to the object it passed in sees that object's keys
         renamed out from under it. That is not a bug to quietly avoid; it is
         the cost of not throwing and not silently dropping the seed (see
         ContextValues above), and it is covered by a test, not just this
         comment. */
    if ("local" in values) {
      for (const [key, value] of Object.entries(values.local)) {
        if (key.startsWith(KEY_PREFIX)) continue;
        if (!Object.hasOwn(values.local, KEY_PREFIX + key)) values.local[KEY_PREFIX + key] = value;
        delete values.local[key];
      }
    }

    this.values = values;

    /* An id the client sent is never forwarded: a proxy's context carries the
       one it was issued, and any other context carries none. */
    if ("shared" in values) {
      this.setHeader(REQUEST_ID, values.shared);
    } else {
      this.init.request.headers!.delete(REQUEST_ID);
    }
  }

  /** `process.env`, typed as `Env`. */
  get env() {
    return process.env as Env;
  }

  /** The origin of the incoming request, e.g. `https://example.com`. */
  get baseUrl() {
    return this.url.origin;
  }

  /**
   * {@link createUrl} with `base` bound to this request's origin.
   *
   * @param options - Path, query and placeholder values.
   * @returns An absolute URL on this origin.
   */
  uri(options?: BaseUrlOptions) {
    return createUrl({
      ...options,
      base: this.baseUrl,
    });
  }

  /**
   * Sets a header on the request as it will be forwarded onward — visible to
   * later middlewares and to the route, not to the client.
   *
   * @param name - Header name.
   * @param value - Header value.
   */
  setHeader(name: string, value: string) {
    this.init.request.headers!.set(name, value);
  }

  /**
   * Stores a value for the rest of this request, for a middleware to hand
   * something to the handler.
   *
   * In a {@link Gateway} the value waits for the {@link Route} that serves the
   * request, which takes it once; unclaimed, it expires after a minute.
   *
   * The key is not stored under the name you give it: it is stored under that
   * name with a `$` in front, because a key named `__proto__` assigned into a
   * plain object writes that object's prototype instead of storing anything.
   * You never write or read the `$` — `set` and `get` both add it themselves,
   * so `get("userId")` reads back what `set("userId", …)` wrote.
   *
   * There is one place you do see it, and it is worth knowing before it
   * surprises you: a context's `values` is an ordinary enumerable property, so
   * logging the context — the first thing most people do inside a `filter` or
   * a {@link Route.error} hook, both of which are handed the context — or
   * calling `JSON.stringify(ctx)`, prints `{"local":{"$userId":"u1"}}`. Those
   * are the stored keys, not a second set of keys beside yours.
   *
   * @example
   * ctx.set("userId", payload.sub);
   *
   * @param key - Storage key.
   * @param value - Value to store.
   */
  set(key: string, value: unknown) {
    if ("shared" in this.values) {
      RequestStore.write(this.values.shared, KEY_PREFIX + key, value);
    } else {
      this.values.local[KEY_PREFIX + key] = value;
    }
  }

  /**
   * Reads a value put there earlier by {@link Context.set}.
   *
   * @param key - Storage key.
   * @returns The value, or `undefined` when it was never set.
   */
  get<DataType>(key: string) {
    const values = "shared" in this.values ? RequestStore.peek(this.values.shared) : this.values.local;
    return values?.[KEY_PREFIX + key] as DataType | undefined;
  }

  /**
   * Continues past this middleware, forwarding the request headers as this
   * context currently has them — the client's, plus every change
   * {@link Context.setHeader} made and every header this middleware deleted
   * from `ctx.init.request.headers` — plus anything `init` adds on top. Only
   * meaningful inside a {@link Gateway}.
   *
   * Behaviour change since 1.1.0, and it is visible to any app that already
   * calls this: `ctx.next()` used to forward the raw incoming request headers
   * and silently drop everything `setHeader` had written, so
   * `ctx.setHeader(name, value); return ctx.next();` was not the same as
   * setting the header and returning nothing. Those two now forward the same
   * headers. An app that was relying on the old behaviour — writing a header
   * with `setHeader` for its own later use and expecting it NOT to reach the
   * route — will see that header at the route from 2.0.0 on.
   *
   * Precedence, highest last: the headers on this context, then `init`'s, then
   * the request id, which this context always sets or removes itself and which
   * neither a middleware nor the client can supply.
   *
   * @param init - Response init, optionally with extra request headers.
   */
  next(init?: MiddlewareResponseInit) {
    /* 0023: the base used to be `new Headers(this.req.headers)` — the raw
       client request, ignoring `this.init.request.headers` entirely. That
       meant `return ctx.next()` silently dropped every `setHeader` a
       middleware had made, because `setHeader` only ever writes to
       `this.init`, never to `this.req`. Building from `this.init` instead
       fixes both directions at once: it already IS "the client's headers
       plus every set/delete a middleware made", since the constructor seeds
       it from `req.headers` and `setHeader` is the only thing that mutates it
       afterward. Wrapping it in a fresh `new Headers(...)` here (rather than
       handing the object itself to `Headers.set` calls below) matters for a
       second, quieter reason: `next()` can be called more than once on the
       same context — nothing stops a middleware from doing that — and
       mutating `this.init.request.headers` directly would make the first
       call's header changes bleed into the second call's baseline. A copy
       keeps each call independent.
       Gluing this onto `this.req.headers` instead (`new Headers(this.req
       .headers)` plus a merge of `this.init`) was the shape that looked
       almost right and was not: `set` on that union still lands, but a
       middleware's `delete()` on `this.init.request.headers` never travels
       — the client's original header is still sitting on `this.req.headers`
       underneath, and a plain merge never removes anything, only adds. Since
       `delete` is the only way a middleware can drop a header the client
       sent, that shape loses exactly the half of `setHeader`'s contract that
       matters for cookies (0024) and CSRF (0025) headers riding through
       `ctx.init` from here on. */
    const combinedHeaders = new Headers(this.init.request.headers);

    /* Checking `?.headers` here rather than stopping at `init?.request` is
       not observably different today — `new Headers(undefined)` (what a
       shallower check plus an unconditional `new Headers(init.request
       .headers)` would build when `request` is present but `headers` is
       not) is itself an empty Headers, same as skipping the block entirely.
       Measured as an accepted surviving mutant, kept for the same reason as
       the `...init?.request` note on the return statement below: correct
       today because `ModifiedRequest` has nothing else on it to react to,
       not because the deeper check is redundant in general. */
    if (init?.request?.headers) {
      const additionalHeaders = new Headers(init.request.headers);
      additionalHeaders.forEach((value, key) => {
        combinedHeaders.set(key, value);
      });
    }

    /* The request id is this context's to set — not the client's, and not the
       caller's: forwarding one it did not issue is how a request reads another's
       values. */
    if ("shared" in this.values) {
      combinedHeaders.set(REQUEST_ID, this.values.shared);
    } else {
      combinedHeaders.delete(REQUEST_ID);
    }

    /* `...init?.request` here looks like it forwards whatever else a caller's
       `request` object might carry beside `headers` — today it forwards
       nothing observable. `ModifiedRequest` (types.ts) declares only
       `headers`, and the very next line unconditionally overwrites that one
       field, so every field this spread could ever contribute is already
       gone by the time the object is built; measured directly against
       `NextResponse.next`, an unlisted extra property on `request` (added at
       runtime, past what the type allows) is dropped by Next itself before
       it reaches anything this package's tests can see, own properties and
       symbols both. Left in rather than removed: dropping it would be
       correct today and silently wrong the moment `ModifiedRequest` grows a
       second field, and there is nothing else here that would need to
       change to keep working then. */
    return this.res.next({
      ...init,
      request: {
        ...init?.request,
        headers: combinedHeaders,
      }
    });
  }

  /**
   * Redirects.
   *
   * @param url - Destination.
   * @param init - Status code, or a full response init.
   */
  redirect(url: string | NextURL, init?: number | ResponseInit) {
    return this.res.redirect(url, init);
  }

  /**
   * Reads the body as JSON.
   *
   * @template T - The expected shape. Unchecked — it is a cast, not a parse.
   */
  json<T = any>() {
    return this.req.json() as Promise<T>;
  }

  /** Reads the body as text. */
  text() {
    return this.req.text();
  }

  /** Reads an `application/x-www-form-urlencoded` body as `URLSearchParams`. */
  async formEncoded() {
    const text = await this.req.text();
    return new URLSearchParams(text);
  }

  /** Reads a `multipart/form-data` body. */
  formData() {
    return this.req.formData();
  }

  /** Reads the body as an `ArrayBuffer`. */
  arrayBuffer() {
    return this.req.arrayBuffer();
  }

  /** Reads the body as a `Blob`. */
  blob() {
    return this.req.blob();
  }

  /**
   * Forgets what this context stored. {@link Route} calls it once the response
   * is built. Nothing is left behind without it — a route takes the proxy's
   * values out of the shared store as it starts, and unclaimed ones expire — but
   * a context kept past its request should not keep its values alive.
   */
  destroy() {
    if ("local" in this.values) {
      for (const key of Object.keys(this.values.local)) delete this.values.local[key];
    }
  }

  /** Shorthand for {@link Memory.activateGateway}. */
  static activateGateway() {
    Memory.activateGateway();
  }
}
