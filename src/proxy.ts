/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Injected, InjectMap, MiddlewareFn, RoutePayload } from "./types";
import { NextRequest } from "next/server";
import { Context } from "./context";
import { Exception } from "./exception";

/* Importing this module anywhere marks the app as proxied. From then on a
   Route whose request lacks `x-ecosyrequest-id` throws, which turns "this route
   was reachable without middleware" into an error at the boundary — and means
   the proxy's `matcher` must cover every route expected to work. */
Context.activateProxy();

/** A middleware in the shape Next expects to be exported from `proxy.ts`. */
export type ProxyNextHandler = (req: NextRequest, payload: RoutePayload) => Promise<Response>;

/** Callable directly as a Next middleware, and chainable. */
export interface IProxyCallable<Injects extends InjectMap = {}> {
  (req: NextRequest, payload: RoutePayload): Promise<Response>;
  /**
   * Adds middlewares, run in order.
   *
   * @param newMiddlewares - Each receives the injected context.
   * @returns A new callable; the receiver is left unchanged.
   */
  use(...newMiddlewares: MiddlewareFn<Injected<Context, Injects>>[]): IProxyCallable<Injects>;
  /**
   * Closes the chain with a final middleware.
   *
   * @param fn - Runs after the ones added with `use`. Omit it to keep just those.
   * @returns A Next middleware.
   */
  proxy(fn?: MiddlewareFn<Injected<Context, Injects>>): ProxyNextHandler;
}

/**
 * Builds the callable that runs the middlewares and converts a throw into a
 * response — an {@link Exception} into its status, a thrown `Response` as-is,
 * anything else into a logged 500.
 *
 * @param injects - Tokens to put on the context.
 * @param middlewares - Middlewares accumulated so far.
 */
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

/**
 * Next middleware with the same dependency injection as a {@link Route}.
 *
 * A middleware returning a `Response` **stops the chain** and that response is
 * sent; returning anything else continues to the next one. This differs from
 * {@link Route}, where a middleware's return value is discarded.
 *
 * @example
 * // src/proxy.ts
 * export const proxy = Proxy({ tokens: Tokens, jwt: Jwt }).use(bearer);
 *
 * export const config = {
 *   matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
 * };
 *
 * @param injects - Tokens to put on the context, or a middleware to run directly.
 * @returns A callable middleware that also has `use` and `proxy`.
 */
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

/** The callable {@link Proxy} plus its statics. */
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

/** See {@link ProxyBase}. `Proxy.use(...)` starts a chain with no injected tokens. */
export const Proxy = ProxyImpl as ProxyFactory;