/* eslint-disable @typescript-eslint/no-empty-object-type */
import { NextRequest } from "next/server";
import { Context, Memory } from "./context";
import { Injected, InjectMap, RouteHandler, RouteNextHandler, RoutePayload } from "./types";
import { Exception } from "./exception";

export type RouteFilter = (e: unknown, context: Context) => unknown;

export interface IRouteBuilder<Injects extends InjectMap = {}, Methods extends Record<string, RouteNextHandler> = {}> {
  use(...newMiddlewares: RouteHandler<Context, Injects>[]): IRouteBuilder<Injects, Methods>;
  filter(fn: RouteFilter): IRouteBuilder<Injects, Methods>;
  route(fn: RouteHandler<Context, Injects>): RouteNextHandler;
  
  get(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { GET: RouteNextHandler }>, "route"> & Methods & { GET: RouteNextHandler };
  post(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { POST: RouteNextHandler }>, "route"> & Methods & { POST: RouteNextHandler };
  put(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { PUT: RouteNextHandler }>, "route"> & Methods & { PUT: RouteNextHandler };
  delete(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { DELETE: RouteNextHandler }>, "route"> & Methods & { DELETE: RouteNextHandler };
  patch(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { PATCH: RouteNextHandler }>, "route"> & Methods & { PATCH: RouteNextHandler };
  options(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { OPTIONS: RouteNextHandler }>, "route"> & Methods & { OPTIONS: RouteNextHandler };
  head(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { HEAD: RouteNextHandler }>, "route"> & Methods & { HEAD: RouteNextHandler };
}

class RouteBuilder<Injects extends InjectMap = {}, Methods extends Record<string, RouteNextHandler> = {}> implements IRouteBuilder<Injects, Methods> {
  constructor(
    public readonly injects: Injects,
    public readonly middlewares: readonly RouteHandler<Context, Injects>[] = [],
    public readonly localFilter: RouteFilter | null = null,
    private readonly _handlers: Methods = {} as Methods
  ) {
    Object.assign(this, _handlers);
  }

  use(...newMiddlewares: RouteHandler<Context, Injects>[]): IRouteBuilder<Injects, Methods> {
    return new RouteBuilder<Injects, Methods>(
      this.injects,
      [...this.middlewares, ...newMiddlewares],
      this.localFilter,
      this._handlers
    );
  }

  filter(fn: RouteFilter): IRouteBuilder<Injects, Methods> {
    return new RouteBuilder<Injects, Methods>(
      this.injects,
      this.middlewares,
      fn,
      this._handlers
    );
  }

  private _createHandler(fn: RouteHandler<Context, Injects>): RouteNextHandler {
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
            await middleware(context as Injected<Context, Injects>);
          }

          // 2. Run Main Handler
          const result = await fn(context as Injected<Context, Injects>);

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

  route(fn: RouteHandler<Context, Injects>): RouteNextHandler {
    if (Object.keys(this._handlers).length > 0) {
      throw new Error("Cannot call .route() after HTTP methods like .get() or .post() have been used.");
    }
    return this._createHandler(fn);
  }

  get(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { GET: RouteNextHandler }>, "route"> & Methods & { GET: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { GET: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, GET: this._createHandler(fn) }
    ) as any;
  }
  
  post(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { POST: RouteNextHandler }>, "route"> & Methods & { POST: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { POST: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, POST: this._createHandler(fn) }
    ) as any;
  }
  
  put(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { PUT: RouteNextHandler }>, "route"> & Methods & { PUT: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { PUT: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, PUT: this._createHandler(fn) }
    ) as any;
  }
  
  delete(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { DELETE: RouteNextHandler }>, "route"> & Methods & { DELETE: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { DELETE: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, DELETE: this._createHandler(fn) }
    ) as any;
  }
  
  patch(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { PATCH: RouteNextHandler }>, "route"> & Methods & { PATCH: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { PATCH: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, PATCH: this._createHandler(fn) }
    ) as any;
  }
  
  options(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { OPTIONS: RouteNextHandler }>, "route"> & Methods & { OPTIONS: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { OPTIONS: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, OPTIONS: this._createHandler(fn) }
    ) as any;
  }
  
  head(fn: RouteHandler<Context, Injects>): Omit<IRouteBuilder<Injects, Methods & { HEAD: RouteNextHandler }>, "route"> & Methods & { HEAD: RouteNextHandler } {
    return new RouteBuilder<Injects, Methods & { HEAD: RouteNextHandler }>(
      this.injects, this.middlewares, this.localFilter, { ...this._handlers, HEAD: this._createHandler(fn) }
    ) as any;
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
  readonly route: (fn: RouteHandler<Context, {}>) => RouteNextHandler;
  readonly get: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { GET: RouteNextHandler }>, "route"> & { GET: RouteNextHandler };
  readonly post: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { POST: RouteNextHandler }>, "route"> & { POST: RouteNextHandler };
  readonly put: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { PUT: RouteNextHandler }>, "route"> & { PUT: RouteNextHandler };
  readonly delete: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { DELETE: RouteNextHandler }>, "route"> & { DELETE: RouteNextHandler };
  readonly patch: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { PATCH: RouteNextHandler }>, "route"> & { PATCH: RouteNextHandler };
  readonly options: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { OPTIONS: RouteNextHandler }>, "route"> & { OPTIONS: RouteNextHandler };
  readonly head: (fn: RouteHandler<Context, {}>) => Omit<IRouteBuilder<{}, { HEAD: RouteNextHandler }>, "route"> & { HEAD: RouteNextHandler };
}

const RouteImpl = Object.assign(RouteBase, {
  error: null as RouteFilter | null,
});

Object.defineProperties(RouteImpl, {
  use: {
    value: (...middlewares: RouteHandler<Context, {}>[]) => {
      return RouteBase().use(...middlewares);
    },
    writable: false,
    configurable: false,
    enumerable: true
  },
  filter: {
    value: (fn: RouteFilter) => {
      return RouteBase().filter(fn);
    },
    writable: false,
    configurable: false,
    enumerable: true
  },
  route: {
    value: (fn: RouteHandler<Context, {}>) => {
      return RouteBase().route(fn);
    },
    writable: false,
    configurable: false,
    enumerable: true
  },
  get: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().get(fn),
    writable: false, configurable: false, enumerable: true
  },
  post: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().post(fn),
    writable: false, configurable: false, enumerable: true
  },
  put: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().put(fn),
    writable: false, configurable: false, enumerable: true
  },
  delete: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().delete(fn),
    writable: false, configurable: false, enumerable: true
  },
  patch: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().patch(fn),
    writable: false, configurable: false, enumerable: true
  },
  options: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().options(fn),
    writable: false, configurable: false, enumerable: true
  },
  head: {
    value: (fn: RouteHandler<Context, {}>) => RouteBase().head(fn),
    writable: false, configurable: false, enumerable: true
  }
});

export const Route = RouteImpl as RouteFactory;