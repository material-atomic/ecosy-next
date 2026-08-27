/* eslint-disable @typescript-eslint/no-empty-object-type */
import { InjectMap, InjectedContext } from "./types";
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
  context: InjectedContext<BootstrapContext, Injects>
) => Promisable<unknown>;

function Bootstrap<Injects extends InjectMap = {}>(injects: Injects, ...fns: BootstrapInitialize<Injects>[]) {
  return class BootstrapBuilder {
    public static _descriptor = {
      injects,
      fns
    };

    static push(fn: BootstrapInitialize<Injects>) {
      return Bootstrap<Injects>(
        BootstrapBuilder._descriptor.injects,
        ...BootstrapBuilder._descriptor.fns,
        fn
      );
    }

    static register(key: string, fn: BootstrapInitialize<Injects>) {
      return this.push(async (context) => {
        const result = await fn(context);
        if (result !== undefined) {
          set(key, result);
        }
        return result;
      });
    }

    constructor() {}

    async execute() {
      const context = new BootstrapContext(BootstrapBuilder._descriptor.injects) as InjectedContext<BootstrapContext, Injects>;
      for (const fn of BootstrapBuilder._descriptor.fns) {
        await fn(context);
      }
    }
  }
}

Bootstrap.get = function get<T>(key: string): T | undefined {
  return _global[BOOTSTRAP_KEY].get(key) as T | undefined;
};

Bootstrap.push = function BootstrapPush(fn: BootstrapInitialize<{}>) {
  return Bootstrap({}).push(fn);
};

Bootstrap.register = function BootstrapRegister(key: string, fn: BootstrapInitialize<{}>) {
  return Bootstrap({}).register(key, fn);
};

export { Bootstrap };