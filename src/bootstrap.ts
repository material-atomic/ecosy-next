/* eslint-disable @typescript-eslint/no-empty-object-type */
import { InjectMap, Injected } from "./types";
import type { Promisable } from "./types";
import { defineTokens } from "./container";

const BOOTSTRAP_KEY = Symbol.for("@ecosy/next:bootstrap-store");

const _global = globalThis as (typeof globalThis & {
  [BOOTSTRAP_KEY]: Map<string, unknown>;
});

if (!_global[BOOTSTRAP_KEY]) {
  _global[BOOTSTRAP_KEY] = new Map();
}

/** The context passed to each bootstrap step, carrying the injected tokens. */
export class BootstrapContext {
  constructor(injects?: InjectMap) {
    if (injects) {
      defineTokens(this, injects);
    }
  }
}

/**
 * Stores a value in the boot store, on `globalThis` under a `Symbol.for` key so
 * a hot reload finds the same Map.
 *
 * @param key - Lookup key for {@link Bootstrap.get}.
 * @param value - Value to keep.
 */
function set<T>(key: string, value: T): T {
  _global[BOOTSTRAP_KEY].set(key, value);
  return value;
}

/** One boot step. Returning a value from a {@link IBootstrapBuilder.register} step stores it. */
export type BootstrapInitialize<Injects extends InjectMap = {}> = (
  context: Injected<BootstrapContext, Injects>
) => Promisable<unknown>;

/** The chainable builder returned by {@link Bootstrap}. Every method returns a new builder. */
export interface IBootstrapBuilder<Injects extends InjectMap = {}> {
  /**
   * Appends a step whose result is discarded.
   *
   * @param fn - The step to run.
   * @returns A new builder; the receiver is left unchanged.
   */
  push(fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects>;
  /**
   * Appends a step and keeps what it returns under `key`, retrievable anywhere
   * with {@link Bootstrap.get}. A step returning `undefined` stores nothing.
   *
   * Registration order is the whole dependency mechanism: steps run in the
   * order they were added, so a step needing the database is registered after
   * the one that opens it.
   *
   * @param key - Lookup key.
   * @param fn - The step to run.
   * @returns A new builder; the receiver is left unchanged.
   */
  register(key: string, fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects>;
  /** Runs every step in order, on a fresh context. */
  execute(): Promise<void>;
  /**
   * Closes the builder.
   *
   * @param fn - Optional final step, run after all the others. It receives a
   * new context, but its injected tokens are the same instances the registered
   * steps saw — and the same ones every route reads.
   * @returns An object with `init()`, to call from `instrumentation.ts`.
   */
  start(fn?: (context: Injected<BootstrapContext, Injects>) => Promisable<void>): { init: () => Promise<void> };
}

class BootstrapBuilder<Injects extends InjectMap = {}> implements IBootstrapBuilder<Injects> {
  constructor(
    public readonly injects: Injects,
    public readonly fns: readonly BootstrapInitialize<Injects>[] = []
  ) {}

  push(fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects> {
    return new BootstrapBuilder(this.injects, [...this.fns, fn]);
  }

  register(key: string, fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects> {
    return this.push(async (context) => {
      const result = await fn(context);
      if (result !== undefined) {
        set(key, result);
      }
      return result;
    });
  }

  async execute(): Promise<void> {
    const context = new BootstrapContext(this.injects) as Injected<BootstrapContext, Injects>;
    for (const fn of this.fns) {
      await fn(context);
    }
  }

  start(fn?: (context: Injected<BootstrapContext, Injects>) => Promisable<void>): { init: () => Promise<void> } {
    return {
      init: async () => {
        await this.execute();
        if (fn) {
          const context = new BootstrapContext(this.injects) as Injected<BootstrapContext, Injects>;
          await fn(context);
        }
      }
    };
  }
}

/** The callable {@link Bootstrap} plus its statics. */
export interface BootstrapFactory {
  <Injects extends InjectMap = {}>(injects?: Injects): IBootstrapBuilder<Injects>;
  get<T>(key: string): T | undefined;
  boost(loader: () => Promise<any>): Promise<void>;
}

/**
 * Ordered startup, wired into `instrumentation.ts`.
 *
 * @example
 * export const bootstrap = Bootstrap({})
 *   .register("db", async () => DataSource.entities([User]).initialize(config))
 *   .register("schedule", async () => new AppSchedule().start())
 *   .start(async () => console.log("ready"));
 *
 * // instrumentation.ts
 * export const { register } = Instrument.nodejs(() => bootstrap.init()).start();
 */
const BootstrapImpl = function <Injects extends InjectMap = {}>(injects?: Injects): IBootstrapBuilder<Injects> {
  return new BootstrapBuilder<Injects>(injects ?? ({} as Injects));
} as BootstrapFactory;

/**
 * Reads a value stored by {@link IBootstrapBuilder.register}.
 *
 * @param key - The key it was registered under.
 * @returns The value, or `undefined` if that step has not run or returned nothing.
 */
BootstrapImpl.get = function get<T>(key: string): T | undefined {
  return _global[BOOTSTRAP_KEY].get(key) as T | undefined;
};

/**
 * Loads a module and runs whatever bootstrap it exports, without the caller
 * naming it: a top-level `init()`, a default export with `init()` or
 * `execute()`, or any named export carrying one.
 *
 * @param loader - A dynamic import, e.g. `() => import("./bootstrap")`.
 */
BootstrapImpl.boost = async function (loader: () => Promise<any>) {
  const mod = await loader();
  if (!mod) return;

  if (typeof mod.init === "function") {
    await mod.init();
    return;
  }

  if (mod.default && typeof mod.default === "object") {
    if (typeof mod.default.init === "function") {
      await mod.default.init();
      return;
    } else if (typeof mod.default.execute === "function") {
      await mod.default.execute();
      return;
    }
  }

  for (const key of Object.keys(mod)) {
    const exported = mod[key];
    if (exported && typeof exported === "object") {
      if (typeof exported.init === "function") {
        await exported.init();
      } else if (typeof exported.execute === "function" && typeof exported.register === "function") {
        await exported.execute();
      }
    }
  }
};

export const Bootstrap = BootstrapImpl;