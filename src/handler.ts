import { Context } from "./context";
import { Inject } from "./inject";
import { Injected, InjectMap, RouteHandler } from "./types";

export function Handler<
  Ctx extends Context = Context,
  Injects extends InjectMap = {}
>(injects: Injects) {
  return class HandlerInjected {
    static handle(handle: RouteHandler<Ctx, Injects>) {
      return async (ctx: Ctx) => {
        Inject.inject(ctx, injects);
        return await handle(ctx as Injected<Ctx, Injects>);
      };
    }
  }
}
