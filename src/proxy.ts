/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Injected, InjectMap, MiddlewareFn, RoutePayload } from "./types";
import { NextRequest } from "next/server";
import { Context } from "./context";
import { Exception } from "./exception";

Context.activateProxy();

export type ProxyNextHandler = (req: NextRequest, payload: RoutePayload) => Promise<Response>;

export interface IProxyCallable<Injects extends InjectMap = {}> {
  (req: NextRequest, payload: RoutePayload): Promise<Response>;
  use(...newMiddlewares: MiddlewareFn<Injected<Context, Injects>>[]): IProxyCallable<Injects>;
  proxy(fn?: MiddlewareFn<Injected<Context, Injects>>): ProxyNextHandler;
}

function createProxyCallable<Injects extends InjectMap>(
  injects: Injects,
  middlewares: MiddlewareFn<Injected<Context, Injects>>[] = []
): IProxyCallable<Injects> {
  const runWithCatch = async (context: Context, fn?: MiddlewareFn<Injected<Context, Injects>>) => {
    try {
      if (middlewares.length) {
        for (const middleware of middlewares) {
          const result = await middleware(context as Injected<Context, Injects>);
          if (result instanceof Response) {
            return result;
          }
        }
      }

      if (fn) {
        const result = await fn(context as Injected<Context, Injects>);
        if (result instanceof Response) {
          return result;
        }
      }
      return null;
    } catch (e: unknown) {
      if (e instanceof Exception) {
        return context.res.json({
          success: false,
          data: null,
          status: e.status,
          statusText: e.statusText,
          headers: e.headers,
          error: e.error,
        });
      } else if (e instanceof Response) {
        return e;
      } else if (
        typeof e === "object" && e !== null && "success" in e && "data" in e && "status" in e && "error" in e
      ) {
        return context.res.json(e);
      } else {
        console.error("[CRITICAL SYSTEM ERROR]", e);
        return context.res.json({
          success: false,
          data: null,
          status: 500,
          statusText: "Internal Server Error",
          headers: {},
          error: "Internal Server Error",
        });
      }
    }
  };

  const handler = async (req: NextRequest, payload: RoutePayload) => {
    const params = await payload.params;
    const context = new Context(req, params, injects);

    const res = await runWithCatch(context);
    if (res) return res;

    return context.res.next(context.init);
  };

  const callable = handler as IProxyCallable<Injects>;

  callable.use = (...newMiddlewares) => {
    return createProxyCallable(injects, [...middlewares, ...newMiddlewares]);
  };

  callable.proxy = (fn) => {
    if (!fn) return handler;

    return async (req: NextRequest, payload: RoutePayload) => {
      const params = await payload.params;
      const context = new Context(req, params, injects);

      const res = await runWithCatch(context, fn);
      if (res) return res;

      return context.res.next(context.init);
    };
  };

  return callable;
}

function ProxyBase<Injects extends InjectMap = {}>(injects?: Injects): IProxyCallable<Injects>;
function ProxyBase(handle: MiddlewareFn<Context>): ProxyNextHandler;
function ProxyBase(
  arg?: InjectMap | MiddlewareFn<Context>
): ProxyNextHandler | IProxyCallable<InjectMap> {
  if (typeof arg === "function") {
    return createProxyCallable<InjectMap>({} as InjectMap).proxy(arg as MiddlewareFn<Context>);
  }

  return createProxyCallable<InjectMap>((arg ?? {}) as InjectMap);
}

export interface ProxyFactory {
  <Injects extends InjectMap = {}>(injects?: Injects): IProxyCallable<Injects>;
  (handle: MiddlewareFn<Context>): ProxyNextHandler;
  readonly use: (...middlewares: MiddlewareFn<Context>[]) => IProxyCallable<{}>;
}

const ProxyImpl = Object.assign(ProxyBase, {});

Object.defineProperties(ProxyImpl, {
  use: {
    get() {
      return function (...middlewares: MiddlewareFn<Context>[]) {
        return createProxyCallable({}, middlewares);
      };
    },
    enumerable: false,
    configurable: false,
  },
});

export const Proxy = ProxyImpl as ProxyFactory;