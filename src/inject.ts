import { InjectMap, ClassType, Injected } from "./types";
import { defineTokens } from "./container";

/**
 * Injects dependencies onto an existing object, one property per key. This is
 * how {@link Route} puts tokens on a request context.
 *
 * Each property holds the token's shared instance directly, built the moment
 * this call runs — not deferred to whenever something happens to read it.
 * Properties are `enumerable`, `writable` and `configurable` but not guarded,
 * so a key that already exists is replaced.
 *
 * @example
 * const ctx = { request };
 * Inject.inject(ctx, { db: Database });
 * ctx.db.query(sql);
 *
 * @template Obj - The object being extended.
 * @template Injects - Map of property name to class token.
 * @param obj - The object to define the properties on.
 * @param injects - Tokens, each constructible with no arguments.
 */
export function inject<Obj, Injects extends InjectMap>(obj: Obj, injects: Injects) {
  defineTokens(obj as object, injects);
}

/**
 * Builds a base class whose instances carry the injected dependencies, so
 * `extends` is how they arrive — no wrapper object, no container to register
 * with.
 *
 * Every instance of the built class, and every context anywhere else naming
 * the same token, reads the one instance of that token — built the first
 * time any request needs it in this process, then reused for good. A token
 * therefore must not keep per-request state on itself — that belongs on the
 * request's {@link Context}.
 *
 * @example
 * class Vendor extends Inject({ fetcher: HttpClient }) {
 *   load(url: string) {
 *     return this.fetcher.get(url);
 *   }
 * }
 *
 * @template Injects - Map of property name to class token.
 * @param injects - Tokens, each constructible with no arguments.
 * @returns A class to extend. Declare a constructor and `super()` first.
 */
function Injectable<Injects extends InjectMap>(injects: Injects): ClassType<Injected<{}, Injects>> {
  return class BaseInjected {
    constructor() {
      inject(this, injects);
    }
  } as ClassType<Injected<{}, Injects>>;
}

/**
 * The dependency-injection primitive underneath {@link Route} and
 * {@link Bootstrap}, usable on its own.
 *
 * Callable as {@link Injectable} to build a base class, and carries
 * {@link inject} for injecting onto an object that already exists.
 */
export const Inject = Object.assign(Injectable, {
  inject,
});
