import { NextRequest } from "next/server";
import { InjectMap, MiddlewareResponseInit } from "./types";
import { createUrl, UrlOptions } from "./url";
import { Res } from "./res";
import { fetcher } from "./fetcher";
import { Cookie } from "./cookie";
import { LiteralObject } from "@ecosy/core";
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

export class Memory {
  static get<DataType>(key: string) {
    return memory.get(key) as DataType | undefined;
  }

  static set<DataType>(key: string, value: DataType) {
    memory.set(key, value);
    return value;
  }

  static remove(key: string) {
    if (memory.has(key)) {
      memory.delete(key);
    }
  }

  static activateProxy() {
    if (!(globalThis as any)[PROXY_KEY]) {
      Object.defineProperty(globalThis, PROXY_KEY, {
        value: true,
        writable: false,
        configurable: false,
      });
    }
  }

  static get isProxyActivated() {
    return !!(globalThis as any)[PROXY_KEY];
  }
}

export type BaseUrlOptions = Omit<UrlOptions, "base">;

export class Context<Env extends LiteralObject = LiteralObject> {
  readonly req: NextRequest;
  readonly url: URL;
  readonly init: Required<MiddlewareResponseInit>;
  readonly params: Record<string, string | string[]>;
  readonly fetcher = fetcher;
  readonly createUrl = createUrl;

  readonly res = Res;
  readonly cookie = Cookie;

  private ecosyRequestId: string | null = null;

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

  get env() {
    return process.env as Env;
  }

  get baseUrl() {
    return this.url.origin;
  }

  uri(options?: BaseUrlOptions) {
    return this.createUrl({
      ...options,
      base: this.baseUrl,
    });
  }

  setHeader(name: string, value: string) {
    this.init.request.headers!.set(name, value);
  }

  set(key: string, value: unknown) {
    if (this.ecosyRequestId) {
      const current: Record<string, unknown> = Memory.get(this.ecosyRequestId) || {};
      current[key] = value;
      Memory.set(this.ecosyRequestId, current);
    }
  }

  get<DataType>(key: string) {
    if (!this.ecosyRequestId) return undefined;
    return (Memory.get(this.ecosyRequestId) as Record<string, DataType>)?.[key];
  }

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

  redirect(url: string | NextURL, init?: number | ResponseInit) {
    return this.res.redirect(url, init);
  }

  json<T = any>() {
    return this.req.json() as Promise<T>;
  }

  text() {
    return this.req.text();
  }

  async formEncoded() {
    const text = await this.req.text();
    return new URLSearchParams(text);
  }

  formData() {
    return this.req.formData();
  }

  arrayBuffer() {
    return this.req.arrayBuffer();
  }

  blob() {
    return this.req.blob();
  }

  destroy() {
    if (this.ecosyRequestId) {
      Memory.remove(this.ecosyRequestId);
    }
  }

  static activateProxy() {
    Memory.activateProxy();
  }
}
