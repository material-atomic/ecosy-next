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
   no change of its own. */
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
 * What a {@link Proxy} hands to a {@link Route} does not live here: it goes
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
  static activateProxy() {
    if (!(globalThis as any)[PROXY_KEY]) {
      Object.defineProperty(globalThis, PROXY_KEY, {
        value: true,
        writable: false,
        configurable: false,
      });
    }
  }

  /** Whether {@link Memory.activateProxy} has been called. */
  static get isProxyActivated() {
    return !!(globalThis as any)[PROXY_KEY];
  }
}

/** {@link UrlOptions} without `base`, which {@link Context.uri} supplies. */
export type BaseUrlOptions = Omit<UrlOptions, "base">;

/**
 * Where a context keeps what {@link Context.set} stores. {@link Proxy} and
 * {@link Route} choose it; a context built by hand keeps its own.
 *
 * - `shared`: written under a signed request id, for the route serving the same
 *   request to take — a Proxy's context.
 * - `local`: held on the context itself — a Route's, starting from whatever the
 *   proxy handed over.
 *
 * Invariant this type does not enforce, and never checks at runtime: every key
 * already inside `local` must already carry {@link Context}'s `$` prefix. The
 * only two things this constructor argument is ever supposed to receive on the
 * `local` branch are `RequestStore.claim()`'s return value — already prefixed,
 * since it only ever holds what `Context.set` wrote — or the literal `{}`
 * default. Constructing a `Context` by hand with a `local` bag that already
 * has bare (unprefixed) keys in it is a fourth way into the bag that this
 * module's three-line fix does not see: a seeded `{ local: { userId: "u1" } }`
 * sits under the bare name `userId`, but `get("userId")` only ever looks under
 * `$userId` — so the seed is invisible from the first read, not stuck. It
 * silently answers `undefined` as if the key had never been set, and stays
 * that way until something calls `Context.set("userId", ...)`, which adds a
 * second, `$`-prefixed entry (`{ userId: "u1", $userId: "u2" }`) and only then
 * makes `get("userId")` answer at all. Nothing here stops that; it is a
 * contract on whoever builds a `local` value, not a check `Context` performs.
 */
export type ContextValues = { shared: string } | { local: Record<string, unknown> };

/**
 * The request context handed to every route handler and middleware — the
 * request itself, its parsed URL and params, response constructors, cookie
 * access, and a per-request bag of values.
 *
 * A context is built per request; its injected dependencies are not. Each is
 * an own getter onto its token's shared instance, built the first time it is
 * read and typed through {@link Injected}. Shared per class, and a class is one
 * per module graph that evaluates it — Next compiles instrumentation, the proxy,
 * route handlers and pages separately — so it is one per process only for a
 * class anchored with `@ecosy/anchor`.
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
   * @param injects - Tokens to define on the context. None is constructed here.
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
   * In a {@link Proxy} the value waits for the {@link Route} that serves the
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
   * Continues past this middleware, carrying the incoming headers plus anything
   * `init` adds. Only meaningful inside a {@link Proxy}.
   *
   * @param init - Response init, optionally with extra request headers.
   */
  next(init?: MiddlewareResponseInit) {
    const combinedHeaders = new Headers(this.req.headers);

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

  /** Shorthand for {@link Memory.activateProxy}. */
  static activateProxy() {
    Memory.activateProxy();
  }
}
