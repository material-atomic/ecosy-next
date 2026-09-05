import { Context } from "./context";
import { Inject } from "./inject";
import { Injected, InjectMap, RouteHandler } from "./types";

/** The chainable builder returned by {@link Handler}. Every method returns a new builder. */
export interface IHandlerBuilder<Ctx extends Context, Injects extends InjectMap> {
  /**
   * Adds middlewares, run in order before the handler.
   *
   * @param middlewares - Functions receiving the injected context.
   * @returns A new builder; the receiver is left unchanged.
   */
  use(...middlewares: RouteHandler<Ctx, Injects>[]): IHandlerBuilder<Ctx, Injects>;
  /**
   * Closes the builder over a handler.
   *
   * @param fn - The handler, receiving the injected context.
   * @returns A plain route handler, so the route need not know what it depends on.
   */
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

/**
 * A route handler with its own dependencies and middlewares, defined away from
 * the route file and passed in later. The tokens are injected onto the context
 * when it runs, so the route stays unaware of them.
 *
 * A middleware's return value is discarded — throw to stop the chain, as in
 * {@link Route}.
 *
 * @example
 * // handlers/create-user.ts
 * export const createUser = Handler({ users: UserRepository })
 *   .use(requireAdmin)
 *   .handle(async (ctx) => ctx.users.create(await ctx.req.json()));
 *
 * // app/api/users/route.ts
 * export const { POST } = Route().post(createUser);
 *
 * @template Ctx - The context the handler receives.
 * @template Injects - Map of property name to class token.
 * @param injects - Tokens to inject onto the context. Defaults to none.
 * @returns A builder; call `.handle()` to get the handler.
 */
export function Handler<
  Ctx extends Context = Context,
  Injects extends InjectMap = {}
>(injects?: Injects): IHandlerBuilder<Ctx, Injects> {
  return new HandlerBuilder<Ctx, Injects>(injects || ({} as Injects));
}
