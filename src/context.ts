import { NextRequest } from "next/server";
import { InjectMap, MiddlewareResponseInit, LiteralObject } from "./types";
import { createUrl, UrlOptions } from "./url";
import { Res } from "./res";
import { Cookie } from "./cookie";
import { NextURL } from "next/dist/server/web/next-url";

const MEMORY_KEY = Symbol.for("@ECOSY/CONTEXT_MEMORY");
const PROXY_KEY = Symbol.for("@ECOSY/CONTEXT_PROXY");
const REQUEST_ID = "x-ecosyrequest-id";

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
 * {@link Context.set} and {@link Context.get} keep per-request state here,
 * keyed by request id, and {@link Context.destroy} removes it again.
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
 * The request context handed to every route handler and middleware — the
 * request itself, its parsed URL and params, response constructors, cookie
 * access, and a per-request bag of values.
 *
 * Injected dependencies are defined on it as own properties, so `ctx.users` is
 * typed through {@link Injected} rather than looked up.
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

  private ecosyRequestId: string | null = null;

  /**
   * A request arriving without an `x-ecosyrequest-id` header is given a fresh
   * one, which is what keys its entry in {@link Memory}.
   *
   * @param req - The incoming request.
   * @param params - Route params, already resolved.
   * @param injects - Tokens to construct and define on the context.
   */
  constructor(
    req: NextRequest,
    params: Record<string, string | string[]>,
    injects?: InjectMap,
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
      for (const [key, ClassToken] of Object.entries(injects)) {
        Object.defineProperty(this, key, {
          value: new ClassToken(),
          enumerable: true,
          configurable: true,
        });
      }
    }

    let reqId = this.req.headers.get(REQUEST_ID);
    if (!reqId) {
      reqId = crypto.randomUUID();
      this.setHeader(REQUEST_ID, reqId);
    }

    this.ecosyRequestId = reqId;
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
   * @example
   * ctx.set("userId", payload.sub);
   *
   * @param key - Storage key.
   * @param value - Value to store.
   */
  set(key: string, value: unknown) {
    if (this.ecosyRequestId) {
      const current: Record<string, unknown> = Memory.get(this.ecosyRequestId) || {};
      current[key] = value;
      Memory.set(this.ecosyRequestId, current);
    }
  }

  /**
   * Reads a value put there earlier by {@link Context.set}.
   *
   * @param key - Storage key.
   * @returns The value, or `undefined` when it was never set.
   */
  get<DataType>(key: string) {
    if (!this.ecosyRequestId) return undefined;
    return (Memory.get(this.ecosyRequestId) as Record<string, DataType>)?.[key];
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
   * Drops this request's entry from {@link Memory}. {@link Route} calls it once
   * the response is built; skipping it leaks the entry for the life of the
   * process.
   */
  destroy() {
    if (this.ecosyRequestId) {
      Memory.remove(this.ecosyRequestId);
    }
  }

  /** Shorthand for {@link Memory.activateProxy}. */
  static activateProxy() {
    Memory.activateProxy();
  }
}
