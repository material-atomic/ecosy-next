import { ClassType, InjectMap } from "./types";

const CONTAINER_KEY = Symbol.for("@ecosy/next:container");

interface ContainerStore {
  /** One instance per class. Weak, so a class dropped by a hot reload goes with its instance. */
  instances: WeakMap<ClassType, unknown>;
  /** Classes whose constructor is running right now, outermost first. */
  constructing: ClassType[];
}

const _global = globalThis as (typeof globalThis & {
  [CONTAINER_KEY]?: ContainerStore;
});

/* On `globalThis` rather than in module scope: the CommonJS and ESM builds are
   separate module instances, and Next can load both in one process. A class
   must resolve to the same instance whichever build reached it. */
if (!_global[CONTAINER_KEY]) {
  _global[CONTAINER_KEY] = { instances: new WeakMap(), constructing: [] };
}

const store = _global[CONTAINER_KEY];

function nameOf(Token: ClassType) {
  return Token.name || "<anonymous class>";
}

/**
 * The instance of a token, constructed on first call and the same object on
 * every call after. The class itself is the key, so it is one instance per class
 * object — and a module evaluated in several module graphs makes several classes.
 * Next compiles instrumentation, the proxy, route handlers and pages separately;
 * a class anchored with `@ecosy/anchor` is the same object in all of them.
 *
 * A constructor that throws leaves nothing cached, so the next call tries again.
 *
 * @param Token - A class constructible with no arguments.
 * @returns Its one instance.
 * @throws When the class is already being constructed further up the stack —
 * a token that needs itself, directly or through others, while being built.
 */
export function resolve<Instance>(Token: ClassType<Instance>): Instance {
  const { instances, constructing } = store;

  if (instances.has(Token)) {
    return instances.get(Token) as Instance;
  }

  const at = constructing.indexOf(Token);
  if (at !== -1) {
    const chain = [...constructing.slice(at), Token].map(nameOf).join(" → ");
    throw new Error(`@ecosy/next: circular token ${chain}`);
  }

  /* Constructors are synchronous, so push and pop bracket exactly this one
     construction — no other resolve can interleave with it. */
  constructing.push(Token);
  try {
    const instance = new Token();
    instances.set(Token, instance);
    return instance;
  } finally {
    constructing.pop();
  }
}

/**
 * Defines one getter per token on `target`. Nothing is constructed here: a
 * token is built the first time any getter for its class is read, anywhere.
 *
 * @param target - The object to define the properties on.
 * @param injects - Property name to class token.
 */
export function defineTokens(target: object, injects: InjectMap) {
  for (const [key, Token] of Object.entries(injects)) {
    if (typeof Token !== "function") {
      throw new TypeError(`@ecosy/next: token "${key}" is not a class`);
    }

    Object.defineProperty(target, key, {
      get: () => resolve(Token),
      enumerable: true,
      configurable: true,
    });
  }
}

/* Lớp con đã mang sẵn getter, tra theo (lớp gốc, bản đồ token). Hai tầng
   WeakMap: cùng một bản đồ dùng với hai lớp gốc khác nhau vẫn ra hai lớp con
   đúng, và không giữ sống lớp nào. */
const subclasses = new WeakMap<object, WeakMap<object, unknown>>();

/**
 * A subclass of `Base` whose prototype already carries one getter per token.
 *
 * WHY THIS EXISTS. `defineTokens(this, injects)` in a constructor defines an
 * accessor property per token on every instance, so a route with five tokens
 * pays five `Object.defineProperty` calls and five closures per request — and
 * an object that gains accessor properties leaves V8's fast path. Measured on
 * an M1: that delivery costs ~3200 ns per request against ~1500 ns for the
 * eager `new Token()` loop it replaced, so the lazy container was *losing* to
 * the thing it improved on whenever tokens are cheap to build.
 *
 * A route's token map is fixed when the route is declared, so the accessors
 * never need defining more than once. Defining them on a prototype moves that
 * whole cost to declaration time; a request then pays for `new` and nothing
 * else. Same laziness, same one-instance-per-class caching, ~100 ns.
 *
 * ONE BEHAVIOUR CHANGE, stated rather than buried: tokens become inherited
 * properties instead of own ones, so `Object.keys(ctx)` and `{...ctx}` no
 * longer list them, and `JSON.stringify(ctx)` no longer walks into them.
 * Reading `ctx.db` is unchanged. This happens to match what the docstring on
 * `Context.set` already claims `JSON.stringify(ctx)` prints, which the own
 * enumerable accessors did not.
 *
 * @param Base - The class to extend, normally `Context`.
 * @param injects - Property name to class token, fixed for the route.
 * @returns A cached subclass; the same map and base always give the same one.
 */
export function withTokens<T extends abstract new (...args: any[]) => any>(
  Base: T,
  injects: InjectMap,
): T {
  let theoBảnĐồ = subclasses.get(Base as object);
  if (!theoBảnĐồ) {
    theoBảnĐồ = new WeakMap();
    subclasses.set(Base as object, theoBảnĐồ);
  }

  const đãCó = theoBảnĐồ.get(injects as object);
  if (đãCó) {
    return đãCó as T;
  }

  const Sub = class extends (Base as unknown as new (...args: any[]) => any) {};
  defineTokens(Sub.prototype, injects);
  theoBảnĐồ.set(injects as object, Sub);
  return Sub as unknown as T;
}
