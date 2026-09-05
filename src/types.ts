import { NextRequest } from "next/server";

/** Any object shape, used where a plain record is expected but the keys are open. */
export type LiteralObject<Keys extends PropertyKey = PropertyKey> =
  | Record<Keys, unknown>
  | { [K in Keys]: unknown }
  | object;

/** A value, or a promise of it — for APIs that accept either. */
export type Promisable<Value> = Value | Promise<Value>;

interface ModifiedRequest {
  headers?: Headers;
}

/** `ResponseInit` plus the request rewriting a Next middleware response can carry. */
export interface MiddlewareResponseInit extends globalThis.ResponseInit {
  request?: ModifiedRequest;
}

/**
 * An injection token: a class constructible with **no arguments**. Anything
 * needing configuration is produced by a factory that captures it and returns
 * such a class.
 */
export type ClassType<Instance = unknown> = new () => Instance;

/** Property name to class token, as passed to {@link Inject}, {@link Route} and {@link Handler}. */
export type InjectMap = {
  [k: string]: ClassType;
};

/** Drops index signatures from `T`, keeping only its declared keys. */
export type RemoveIndexSignature<T> = {
  [K in keyof T as {} extends Record<K, unknown> ? never : K]: T[K];
};

/**
 * A context plus its injected members — what a route handler receives. Each key
 * is typed as the instance its token constructs.
 */
export type Injected<Context, Injects extends InjectMap> = Context & RemoveIndexSignature<{
  [K in keyof Injects]: Injects[K] extends ClassType<infer Instance>
    ? Instance
    : never;
}>;

/**
 * A {@link Proxy} middleware. Returning a `Response` stops the chain and sends
 * it; returning anything else continues to the next one.
 */
export interface MiddlewareFn<Context> {
  (context: Context): Response | void | Promise<Response | void>;
}

/** The second argument Next passes to a route handler. */
export interface RoutePayload {
  params: Promise<Record<string, string | string[]>>;
  searchParams?: Promise<Record<string, string | string[]>>;
}

/** A handler in the shape Next expects to be exported from a `route.ts`. */
export type RouteNextHandler = (req: any, payload: RoutePayload) => Promisable<Response>;
/**
 * A handler written against an injected context. Returning a `Response` sends
 * it untouched; returning anything else is wrapped in an {@link HttpResponse}.
 */
export type RouteHandler<Context, Injects extends InjectMap> = (context: Injected<Context, Injects>) => Promisable<unknown>;
