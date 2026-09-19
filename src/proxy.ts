/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Injected, InjectMap, MiddlewareFn, RoutePayload } from "./types";
import { NextRequest } from "next/server";
import { Context } from "./context";
import { Exception } from "./exception";
import { Res } from "./res";
import { checkRequestId, mintRequestId } from "./request-id";
import { REQUEST_ID } from "./request-store";

/** A middleware in the shape Next expects to be exported from `proxy.ts`. */
export type GatewayNextHandler = (req: NextRequest, payload: RoutePayload) => Promise<Response>;

/** Callable directly as a Next middleware, and chainable. */
export interface IGatewayCallable<Injects extends InjectMap = {}> {
  (req: NextRequest, payload: RoutePayload): Promise<Response>;
  /**
   * Adds middlewares, run in order.
   *
   * @param newMiddlewares - Each receives the injected context.
   * @returns A new callable; the receiver is left unchanged.
   */
  use(...newMiddlewares: MiddlewareFn<Injected<Context, Injects>>[]): IGatewayCallable<Injects>;
  /**
   * Closes the chain with a final middleware.
   *
   * @param fn - Runs after the ones added with `use`. Omit it to keep just those.
   * @returns A Next middleware.
   */
  proxy(fn?: MiddlewareFn<Injected<Context, Injects>>): GatewayNextHandler;
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
): IGatewayCallable<Injects> {
  /* Building a Gateway — not importing this module — marks the app as proxied.
     The root entry re-exports this module, so activating on import proxied
     every app that imported anything from the package, Gateway or not. From here
     on a Route whose request lacks `x-ecosyrequest-id` throws, which turns "this
     route was reachable without middleware" into an error at the boundary — and
     means the proxy's `matcher` must cover every route expected to work. */
  Context.activateGateway();

  /* `buildContext` used to be the caller's job — `serve` built the Context
     itself, outside of this function entirely, and only handed the finished
     object in here. That was fine while building a Context only installed
     getters: nothing about it could throw. Since 0064, defineTokens resolves
     every token eagerly inside the Context constructor, so a token whose
     constructor throws (a database not up yet, say) now throws from `new
     Context(...)` itself — and that has to land in the SAME catch that
     already turns a middleware's throw into a response, or it exits `serve`
     as an unhandled rejection instead of a 500.
     Taking a factory instead of an already-built context is what makes that
     possible: there is no way to have "context built before this call, but
     its construction still guarded by this call's try" any other way. The
     cost is that `context` inside the catch block below may be `undefined`
     — the one case where `buildContext()` itself is what threw — so the
     error branches use `Res.json` (the same static helper `context.res.json`
     always was; `Context.res` is just `Res`) instead of reaching through an
     instance that might not exist. */
  const runWithCatch = async (
    buildContext: () => Context,
    fn?: MiddlewareFn<Injected<Context, Injects>>
  ): Promise<{ context: Context | undefined; response: Response | null }> => {
    let context: Context | undefined;
    try {
      context = buildContext();

      if (middlewares.length) {
        for (const middleware of middlewares) {
          const result = await middleware(context as Injected<Context, Injects>);
          if (result instanceof Response) {
            return { context, response: result };
          }
        }
      }

      if (fn) {
        const result = await fn(context as Injected<Context, Injects>);
        if (result instanceof Response) {
          return { context, response: result };
        }
      }
      return { context, response: null };
    } catch (e: unknown) {
      if (e instanceof Exception) {
        return {
          context,
          response: Res.json({
            success: false,
            data: null,
            status: e.status,
            statusText: e.statusText,
            headers: e.headers,
            error: e.error,
          }),
        };
      } else if (e instanceof Response) {
        return { context, response: e };
      } else if (
        typeof e === "object" && e !== null && "success" in e && "data" in e && "status" in e && "error" in e
      ) {
        return { context, response: Res.json(e) };
      } else {
        console.error("[CRITICAL SYSTEM ERROR]", e);
        return {
          context,
          response: Res.json({
            success: false,
            data: null,
            status: 500,
            statusText: "Internal Server Error",
            headers: {},
            error: "Internal Server Error",
          }),
        };
      }
    }
  };

  /* Every request gets an id minted here. One the client sent is never used:
     an id this process did not issue is a forgery and is refused before any
     middleware runs, and one it did issue is being replayed — ignored, and the
     request still gets a fresh one. */
  const serve = async (req: NextRequest, payload: RoutePayload, fn?: MiddlewareFn<Injected<Context, Injects>>) => {
    const incoming = req.headers.get(REQUEST_ID);
    if (incoming !== null && (await checkRequestId(incoming)) !== "valid") {
      return Res.json({
        success: false,
        data: null,
        status: 400,
        statusText: "Bad Request",
        headers: {},
        error: "Invalid x-ecosyrequest-id header",
      });
    }

    const params = await payload.params;
    const shared = await mintRequestId();

    const { context, response } = await runWithCatch(
      () => new Context(req, params, injects, { shared }),
      fn
    );
    if (response) return response;

    /* Reaching here means runWithCatch returned no response, which only
       happens on its success path — the one branch that always assigns
       `context` before returning. The `!` is safe for that reason, not
       because TypeScript can see it. */
    return context!.res.next(context!.init);
  };

  const handler = (req: NextRequest, payload: RoutePayload) => serve(req, payload);

  const callable = handler as IGatewayCallable<Injects>;

  callable.use = (...newMiddlewares) => {
    return createProxyCallable(injects, [...middlewares, ...newMiddlewares]);
  };

  callable.proxy = (fn) => {
    if (!fn) return handler;

    return (req: NextRequest, payload: RoutePayload) => serve(req, payload, fn);
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
 * Building one marks the app as proxied: from then on every {@link Route}
 * demands the `x-ecosyrequest-id` header the proxy adds, so the `matcher` must
 * cover every route expected to work. Importing the package alone does not.
 *
 * @example
 * // src/proxy.ts
 * export const proxy = Gateway({ tokens: Tokens, jwt: Jwt }).use(bearer);
 *
 * export const config = {
 *   matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
 * };
 *
 * @param injects - Tokens to put on the context, or a middleware to run directly.
 * @returns A callable middleware that also has `use` and `proxy`.
 */
function ProxyBase<Injects extends InjectMap = {}>(injects?: Injects): IGatewayCallable<Injects>;
function ProxyBase(handle: MiddlewareFn<Context>): GatewayNextHandler;
function ProxyBase(
  arg?: InjectMap | MiddlewareFn<Context>
): GatewayNextHandler | IGatewayCallable<InjectMap> {
  if (typeof arg === "function") {
    return createProxyCallable<InjectMap>({} as InjectMap).proxy(arg as MiddlewareFn<Context>);
  }

  return createProxyCallable<InjectMap>((arg ?? {}) as InjectMap);
}

/** The callable {@link Gateway} plus its statics. */
export interface GatewayFactory {
  <Injects extends InjectMap = {}>(injects?: Injects): IGatewayCallable<Injects>;
  (handle: MiddlewareFn<Context>): GatewayNextHandler;
  readonly use: (...middlewares: MiddlewareFn<Context>[]) => IGatewayCallable<{}>;
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

/** See {@link ProxyBase}. `Gateway.use(...)` starts a chain with no injected tokens. */
export const Gateway = ProxyImpl as GatewayFactory;