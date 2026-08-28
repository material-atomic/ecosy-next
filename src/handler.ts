import { Context } from "./context";
import { Inject } from "./inject";
import { Injected, InjectMap, RouteHandler } from "./types";

export interface IHandlerBuilder<Ctx extends Context, Injects extends InjectMap> {
  use(...middlewares: RouteHandler<Ctx, Injects>[]): IHandlerBuilder<Ctx, Injects>;
  handle(fn: RouteHandler<Ctx, Injects>): RouteHandler<Ctx, {}>;
}

class HandlerBuilder<Ctx extends Context, Injects extends InjectMap> implements IHandlerBuilder<Ctx, Injects> {
  constructor(
    public readonly injects: Injects,
    public readonly middlewares: readonly RouteHandler<Ctx, Injects>[] = []
  ) {}

  use(...newMiddlewares: RouteHandler<Ctx, Injects>[]): IHandlerBuilder<Ctx, Injects> {
    return new HandlerBuilder(this.injects, [...this.middlewares, ...newMiddlewares]);
  }

  handle(fn: RouteHandler<Ctx, Injects>): RouteHandler<Ctx, {}> {
    const injects = this.injects;
    const middlewares = this.middlewares;

    return async (ctx: Ctx) => {
      Inject.inject(ctx, injects);
      const injectedCtx = ctx as Injected<Ctx, Injects>;

      for (const middleware of middlewares) {
        await middleware(injectedCtx);
      }

      return await fn(injectedCtx);
    };
  }
}

export function Handler<
  Ctx extends Context = Context,
  Injects extends InjectMap = {}
>(injects?: Injects): IHandlerBuilder<Ctx, Injects> {
  return new HandlerBuilder<Ctx, Injects>(injects || ({} as Injects));
}
