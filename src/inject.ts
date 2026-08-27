import { InjectMap, ClassType, Injected } from "./types";

export function inject<Obj, Injects extends InjectMap>(obj: Obj, injects: Injects) {
  for (const [key, ClassToken] of Object.entries(injects)) {
    Object.defineProperty(obj, key, {
      value: new ClassToken(),
      enumerable: true,
      configurable: true,
    });
  }
}

function Injectable<Injects extends InjectMap>(injects: Injects): ClassType<Injected<{}, Injects>> {
  return class BaseInjected {
    constructor() {
      inject(this, injects);
    }
  } as ClassType<Injected<{}, Injects>>;
}

export const Inject = Object.assign(Injectable, {
  inject,
});
