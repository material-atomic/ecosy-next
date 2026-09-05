import type { Promisable } from "./types";

/** A startup step for one runtime. */
export type InstrumentHandler = () => Promisable<unknown>;
/** A handler for Next's `onRequestError`. */
export type InstrumentErrorHandler = (err: any, req: any, ctx: any) => Promisable<unknown>;

/** A declarative step: dynamic imports to run at startup. */
export interface InstrumentConfig {
  bootstrap?: (() => Promisable<unknown>)[];
}

/** Either a function to call or a {@link InstrumentConfig} to load. */
export type InstrumentParam = InstrumentHandler | InstrumentConfig;

/** What a builder has accumulated so far, per runtime. */
interface InstrumentDescriptor {
  readonly nodejs: readonly InstrumentParam[];
  readonly edge: readonly InstrumentParam[];
  readonly browser: readonly InstrumentParam[];
  readonly error: readonly InstrumentErrorHandler[];
}

/** The chainable builder returned by {@link InstrumentBase}. Every method returns a new builder. */
export interface IInstrumentBuilder {
  /**
   * Adds a step that runs only under the Node.js runtime.
   *
   * @param param - A function, or imports to load.
   */
  nodejs(param: InstrumentParam): IInstrumentBuilder;
  /**
   * Adds a step that runs only under the Edge runtime.
   *
   * @param param - A function, or imports to load.
   */
  edge(param: InstrumentParam): IInstrumentBuilder;
  /**
   * Adds a step that runs only in the browser.
   *
   * @param param - A function, or imports to load.
   */
  browser(param: InstrumentParam): IInstrumentBuilder;
  /**
   * Adds a handler for `onRequestError`. All of them run, in order.
   *
   * @param fn - Receives the error, the request and Next's context.
   */
  error(fn: InstrumentErrorHandler): IInstrumentBuilder;
  /**
   * Runs the steps for whichever runtime this is — browser first if `window`
   * exists, otherwise by `NEXT_RUNTIME`. A failing import inside an
   * {@link InstrumentConfig} is warned about, not thrown.
   */
  execute(): Promise<void>;
  /**
   * Closes the builder.
   *
   * @returns `register` and `onRequestError`, to re-export from
   * `instrumentation.ts` under exactly those names.
   */
  start(): {
    register: () => Promise<void>;
    onRequestError: (err: unknown, req: unknown, ctx: unknown) => Promise<void>;
  };
}

/**
 * Builds an instrumentation builder from an existing descriptor. Use the
 * ready-made {@link Instrument} unless you are starting from steps of your own.
 *
 * @param descriptor - Steps accumulated so far. Defaults to none.
 */
export function InstrumentBase(descriptor: InstrumentDescriptor = { nodejs: [], edge: [], browser: [], error: [] }): IInstrumentBuilder {
  return class InstrumentBuilder {
    private static _descriptor = descriptor;

    static nodejs(param: InstrumentParam) {
      return InstrumentBase({
        ...InstrumentBuilder._descriptor,
        nodejs: [...InstrumentBuilder._descriptor.nodejs, param],
      });
    }

    static edge(param: InstrumentParam) {
      return InstrumentBase({
        ...InstrumentBuilder._descriptor,
        edge: [...InstrumentBuilder._descriptor.edge, param],
      });
    }

    static browser(param: InstrumentParam) {
      return InstrumentBase({
        ...InstrumentBuilder._descriptor,
        browser: [...InstrumentBuilder._descriptor.browser, param],
      });
    }

    static error(fn: InstrumentErrorHandler) {
      return InstrumentBase({
        ...InstrumentBuilder._descriptor,
        error: [...InstrumentBuilder._descriptor.error, fn],
      });
    }

    static async execute() {
      const runHandlers = async (handlers: readonly InstrumentParam[], envName: string) => {
        for (const param of handlers) {
          if (typeof param === "function") {
            await param();
          } else {
            if (param.bootstrap && Array.isArray(param.bootstrap)) {
              for (const importer of param.bootstrap) {
                try {
                  await importer();
                  console.log(`[Instrument] Auto-loaded ${envName} bootstrap.`);
                } catch (e) {
                  console.warn(`[Instrument] Failed to load ${envName} bootstrap importer:`, e);
                }
              }
            }
          }
        }
      };

      if (typeof window !== "undefined") {
        await runHandlers(InstrumentBuilder._descriptor.browser, "Browser");
      } else if (process.env.NEXT_RUNTIME === "nodejs") {
        await runHandlers(InstrumentBuilder._descriptor.nodejs, "Node.js");
      } else if (process.env.NEXT_RUNTIME === "edge") {
        await runHandlers(InstrumentBuilder._descriptor.edge, "Edge");
      }
    }

    static start() {
      return {
        register: async () => {
          await this.execute();
        },
        onRequestError: async (err: unknown, req: unknown, ctx: unknown) => {
          for (const fn of InstrumentBuilder._descriptor.error) {
            await fn(err, req, ctx);
          }
        }
      };
    }
  }
}

/**
 * Per-runtime startup, in the shape `instrumentation.ts` expects.
 *
 * @example
 * // instrumentation.ts
 * export const { register, onRequestError } = Instrument
 *   .nodejs(() => bootstrap.init())
 *   .error((err) => reportToSentry(err))
 *   .start();
 */
export const Instrument = InstrumentBase();
