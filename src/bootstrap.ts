/* eslint-disable @typescript-eslint/no-empty-object-type */
import { InjectMap, Injected } from "./types";
import type { Promisable } from "./types";

const BOOTSTRAP_KEY = Symbol.for("SNIP_RENDER_BOOTSTRAP_STORE");

const _global = globalThis as (typeof globalThis & {
  [BOOTSTRAP_KEY]: Map<string, unknown>;
});

if (!_global[BOOTSTRAP_KEY]) {
  _global[BOOTSTRAP_KEY] = new Map();
}

export class BootstrapContext {
  constructor(injects?: InjectMap) {
    if (injects) {
      for (const [key, ClassToken] of Object.entries(injects)) {
        Object.defineProperty(this, key, {
          value: new ClassToken(),
          enumerable: true,
          configurable: true,
        });
      }
    }
  }
}

function set<T>(key: string, value: T): T {
  _global[BOOTSTRAP_KEY].set(key, value);
  return value;
}

export type BootstrapInitialize<Injects extends InjectMap = {}> = (
  context: Injected<BootstrapContext, Injects>
) => Promisable<unknown>;

export interface IBootstrapBuilder<Injects extends InjectMap = {}> {
  push(fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects>;
  register(key: string, fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects>;
  execute(): Promise<void>;
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
    console.log(`[BootstrapBuilder] execute() called. Total fns: ${this.fns.length}`);
    const context = new BootstrapContext(this.injects) as Injected<BootstrapContext, Injects>;
    for (const fn of this.fns) {
      await fn(context);
    }
    console.log(`[BootstrapBuilder] execute() finished.`);
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

export interface BootstrapFactory {
  <Injects extends InjectMap = {}>(injects?: Injects): IBootstrapBuilder<Injects>;
  get<T>(key: string): T | undefined;
  boost(loader: () => Promise<any>): Promise<void>;
}

const BootstrapImpl = function <Injects extends InjectMap = {}>(injects?: Injects): IBootstrapBuilder<Injects> {
  return new BootstrapBuilder<Injects>(injects ?? ({} as Injects));
} as BootstrapFactory;

BootstrapImpl.get = function get<T>(key: string): T | undefined {
  return _global[BOOTSTRAP_KEY].get(key) as T | undefined;
};

BootstrapImpl.boost = async function (loader: () => Promise<any>) {
  const mod = await loader();
  if (!mod) return;

  if (typeof mod.init === "function") {
    console.log("[Bootstrap.boost] Found top-level init()");
    await mod.init();
    return;
  }

  if (mod.default && typeof mod.default === "object") {
    if (typeof mod.default.init === "function") {
      console.log("[Bootstrap.boost] Found default.init()");
      await mod.default.init();
      return;
    } else if (typeof mod.default.execute === "function") {
      console.log("[Bootstrap.boost] Found default.execute()");
      await mod.default.execute();
      return;
    }
  }

  for (const key of Object.keys(mod)) {
    const exported = mod[key];
    if (exported && typeof exported === "object") {
      if (typeof exported.init === "function") {
        console.log(`[Bootstrap.boost] Found exported.${key}.init()`);
        await exported.init();
      } else if (typeof exported.execute === "function" && typeof exported.register === "function") {
        console.log(`[Bootstrap.boost] Found exported.${key}.execute()`);
        await exported.execute();
      }
    }
  }
};

export const Bootstrap = BootstrapImpl;