import { Promisable } from "@ecosy/core";

export type InstrumentHandler = () => Promisable<unknown>;
export type InstrumentErrorHandler = (err: any, req: any, ctx: any) => Promisable<unknown>;

export interface InstrumentConfig {
  bootstrap?: (() => Promisable<unknown>)[];
}

export type InstrumentParam = InstrumentHandler | InstrumentConfig;

interface InstrumentDescriptor {
  readonly nodejs: readonly InstrumentParam[];
  readonly edge: readonly InstrumentParam[];
  readonly browser: readonly InstrumentParam[];
  readonly error: readonly InstrumentErrorHandler[];
}

export interface IInstrumentBuilder {
  nodejs(param: InstrumentParam): IInstrumentBuilder;
  edge(param: InstrumentParam): IInstrumentBuilder;
  browser(param: InstrumentParam): IInstrumentBuilder;
  error(fn: InstrumentErrorHandler): IInstrumentBuilder;
  execute(): Promise<void>;
  start(): {
    register: () => Promise<void>;
    onRequestError: (err: unknown, req: unknown, ctx: unknown) => Promise<void>;
  };
}

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

export const Instrument = InstrumentBase();
