import { Promisable } from "@ecosy/core";
import { NextRequest } from "next/server";

interface ModifiedRequest {
  headers?: Headers;
}

export interface MiddlewareResponseInit extends globalThis.ResponseInit {
  request?: ModifiedRequest;
}

export type ClassType<Instance = unknown> = new () => Instance;

export type InjectMap = {
  [k: string]: ClassType;
};

export type RemoveIndexSignature<T> = {
  [K in keyof T as {} extends Record<K, unknown> ? never : K]: T[K];
};

export type InjectedContext<Context, Injects extends InjectMap> = Context & RemoveIndexSignature<{
  [K in keyof Injects]: Injects[K] extends new () => infer Instance
    ? Instance
    : never;
}>;

export interface MiddlewareFn<Context> {
  (context: Context): Response | void | Promise<Response | void>;
}

export interface RoutePayload {
  params: Promise<Record<string, string | string[]>>;
  searchParams: Promise<Record<string, string | string[]>>;
}

export type RouteNextHandler = (req: NextRequest, payload: RoutePayload) => Promisable<Response>;
export type RouteHandler<Context, Injects extends InjectMap> = (context: InjectedContext<Context, Injects>) => Promisable<unknown>;
