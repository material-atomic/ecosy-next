/* eslint-disable @typescript-eslint/no-empty-object-type */
import { NextRequest } from "next/server";
import { Context, Memory } from "./context";
import { InjectedContext, InjectMap, RouteHandler, RouteNextHandler, RoutePayload } from "./types";
import { Exception } from "./exception";

export type RouteFilter = (e: unknown, context: Context) => unknown;

export interface IRouteBuilder<Injects extends InjectMap = {}> {
  use(...newMiddlewares: RouteHandler<Context, Injects>[]): IRouteBuilder<Injects>;
  filter(fn: RouteFilter): IRouteBuilder<Injects>;
  route(fn: RouteHandler<Context, Injects>): RouteNextHandler;
}

class RouteBuilder<Injects extends InjectMap = {}> implements IRouteBuilder<Injects> {
  constructor(
    public readonly injects: Injects,
    public readonly middlewares: readonly RouteHandler<Context, Injects>[] = [],
    public readonly localFilter: RouteFilter | null = null
  ) {}

  use(...newMiddlewares: RouteHandler<Context, Injects>[]): IRouteBuilder<Injects> {
    return new RouteBuilder<Injects>(
      this.injects,
      [...this.middlewares, ...newMiddlewares],
      this.localFilter
    );
  }

  filter(fn: RouteFilter): IRouteBuilder<Injects> {
    return new RouteBuilder<Injects>(
      this.injects,
      this.middlewares,
      fn
    );
  }

  route(fn: RouteHandler<Context, Injects>): RouteNextHandler {
    const injectsMap = this.injects;
    const middlewares = this.middlewares;
    const localFilter = this.localFilter;

    return async (req: NextRequest, payload: RoutePayload) => {
      let res: Response;
      
      const params = await payload.params;
      const context = new Context(req, params, injectsMap);

      const isProxyActivated = Memory.isProxyActivated;

      if (isProxyActivated && !req.headers.has("x-ecosyrequest-id")) {
        throw new Error("[Ecosy] Missing 'x-ecosyrequest-id' header in a proxied environment. Ensure this request passes through the Proxy middleware.");
      }

      try {
        try {
          if (!fn) {
            throw new Error("Route missing handler");
          }

        // 1. Run Middlewares
        for (const middleware of middlewares) {
          await middleware(context as InjectedContext<Context, Injects>);
        }

        // 2. Run Main Handler
        const result = await fn(context as InjectedContext<Context, Injects>);

        // 3. Format Response
        if (result instanceof Response) {
          res = result;
        } else {
          res = context.res.json({
            success: true,
            data: result,
            status: 200,
            statusText: "OK",
            headers: {},
            error: null,
          });
        }
      } catch (err) {
        let e = err;

        // 4. Local Error Hook (from .filter)
        if (localFilter) {
          try {
            const hookResult = localFilter(e, context);
            if (hookResult !== undefined) {
              e = hookResult;
            }
          } catch (hookError) {
            console.error("[CRITICAL SYSTEM ERROR] Route local filter failed:", hookError);
          }
        }

        // 5. Global Error Hook
        if (Route.error) {
          try {
            const hookResult = Route.error(e, context);
            if (hookResult !== undefined) {
              e = hookResult;
            }
          } catch (hookError) {
            console.error("[CRITICAL SYSTEM ERROR] Route.error hook failed:", hookError);
          }
        }

        if (e instanceof Exception) {
          res = context.res.json({
            success: false,
            data: null,
            status: e.status,
            statusText: e.statusText,
            headers: e.headers,
            error: e.error,
          });
        } else if (e instanceof Response) {
          res = e;
        } else if (
          typeof e === "object" && e !== null && "success" in e && "data" in e && "status" in e && "error" in e
        ) {
          res = context.res.json(e);
        } else {
          console.error("[CRITICAL SYSTEM ERROR]", e);
          res = context.res.json({
            success: false,
            data: null,
            status: 500,
            statusText: "Internal Server Error",
            headers: {},
            error: "Internal Server Error",
          });
        }
      }
      } finally {
        context.destroy();
      }

      return res;
    };
  }
}

function RouteBase(handle: RouteHandler<Context, {}>): RouteNextHandler;
function RouteBase<Injects extends InjectMap = {}>(injects?: Injects): IRouteBuilder<Injects>;
function RouteBase(arg?: InjectMap | RouteHandler<Context, {}>): RouteNextHandler | IRouteBuilder<InjectMap> {
  if (typeof arg === "function") {
    return new RouteBuilder<InjectMap>({}).route(arg as RouteHandler<Context, {}>);
  }

  return new RouteBuilder<InjectMap>((arg ?? {}) as InjectMap);
}

export interface RouteFactory {
  (handle: RouteHandler<Context, {}>): RouteNextHandler;
  <Injects extends InjectMap = {}>(injects?: Injects): IRouteBuilder<Injects>;
  error: RouteFilter | null;
  readonly use: (...middlewares: RouteHandler<Context, {}>[]) => IRouteBuilder<{}>;
  readonly filter: (fn: RouteFilter) => IRouteBuilder<{}>;
}

const RouteImpl = Object.assign(RouteBase, {
  error: null as RouteFilter | null,
});

Object.defineProperties(RouteImpl, {
  use: {
    value: (...middlewares: RouteHandler<Context, {}>[]) => {
      return new RouteBuilder({}).use(...middlewares);
    },
    writable: false,
    configurable: false,
    enumerable: true
  },
  filter: {
    value: (fn: RouteFilter) => {
      return new RouteBuilder({}).filter(fn);
    },
    writable: false,
    configurable: false,
    enumerable: true
  }
});

export const Route = RouteImpl as RouteFactory;