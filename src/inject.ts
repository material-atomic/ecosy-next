import { InjectMap, ClassType, Injected } from "./types";

/**
 * Injects dependencies onto an existing object, one property per key. This is
 * how {@link Route} puts tokens on a request context.
 *
 * Properties are defined `enumerable` and `configurable` but not guarded, so a
 * key that already exists is replaced.
 *
 * @example
 * const ctx = { request };
 * Inject.inject(ctx, { db: Database });
 * ctx.db.query(sql);
 *
 * @template Obj - The object being extended.
 * @template Injects - Map of property name to class token.
 * @param obj - The object to define the properties on.
 * @param injects - Tokens to construct, each with no arguments.
 */
export function inject<Obj, Injects extends InjectMap>(obj: Obj, injects: Injects) {
  for (const [key, ClassToken] of Object.entries(injects)) {
    Object.defineProperty(obj, key, {
      value: new ClassToken(),
      enumerable: true,
      configurable: true,
    });
  }
}

/**
 * Builds a base class whose instances carry the injected dependencies, so
 * `extends` is how they arrive — no wrapper object, no container to register
 * with.
 *
 * Tokens are constructed every time the class is, so anything worth reusing
 * should be a singleton captured by a factory that hands the same instance out.
 *
 * @example
 * class Vendor extends Inject({ fetcher: HttpClient }) {
 *   load(url: string) {
 *     return this.fetcher.get(url);
 *   }
 * }
 *
 * @template Injects - Map of property name to class token.
 * @param injects - Tokens to construct, each with no arguments.
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
