/* eslint-disable @typescript-eslint/no-explicit-any */
const STORE_KEY = Symbol.for("SNIP_RENDER_STORE");
const PROXY_KEY = Symbol.for("SNIP_RENDER_PROXY");

const _global = globalThis as (typeof globalThis & {
  [STORE_KEY]: Map<string, any>;
})

if (!_global[STORE_KEY]) {
  _global[STORE_KEY] = new Map();
}

const store = _global[STORE_KEY];

export class Store {
  static get<DataType>(key: string) {
    return store.get(key) as DataType | undefined;
  }

  static set<DataType>(key: string, value: DataType) {
    store.set(key, value);
    return value;
  }

  static remove(key: string) {
    if (store.has(key)) {
      store.delete(key);
    }
  }

  static activateProxy() {
    if (!(globalThis as any)[PROXY_KEY]) {
      Object.defineProperty(globalThis, PROXY_KEY, {
        value: true,
        writable: false,
        configurable: false,
      });
    }
  }

  static get isProxyActivated() {
    return !!(globalThis as any)[PROXY_KEY];
  }
}
