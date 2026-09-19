/* This file does not implement CSRF. There is no token generation here, no
   comparison, no secret read — none of that is a line away, it is simply
   not in this file, and `tests/no-core-dep.test.mjs` is the test that keeps
   it that way by scanning `src/`, `dist/` and `package.json` for any trace
   of `@ecosy/core`, where the real implementation lives.

   What this file ships instead is the SOCKET: `CsrfPort` declares the shape
   a CSRF module has to satisfy, `IdentityPort` declares the shape something
   providing identity has to satisfy, and `csrfOrigin`/`csrfGuard` are the
   two connectors that wire either into the two places Next asks for a
   middleware — a Gateway, a Route. Catching `Forbidden` into a 403, calling at
   the right point, building a jar from the context: that is Next-shaped
   knowledge, not CSRF-shaped knowledge, and it is all this file knows. Given
   no `Csrf` class and no `identity`/`bind`, `csrfGuard` cannot do anything —
   the app brings the implementation; this package only brings the plug. */
import "server-only";
import { cookieJar, type CookieForwarding } from "./cookie-jar";
import { Forbidden } from "./exception";
import type { Context } from "./context";
import type { ClassType, Promisable } from "./types";

/**
 * What a CSRF module has to offer for these middlewares — `@ecosy/core/csrf`
 * among them. Declared here rather than imported, so this package depends on
 * none of them.
 */
export interface CsrfPort {
  origin(request: Request): boolean;
  check(request: Request, options: { bind: string; purpose?: string }): Promise<boolean>;
}

/** A class constructible with no arguments that yields a {@link CsrfPort}. */
export type CsrfPortClass = ClassType<CsrfPort>;

/**
 * What an identity provider has to offer here: loading one from a jar, and
 * the id to bind a CSRF token to. "Session" is the app's own word for
 * whatever backs this — a cookie-backed store, most often — and that word is
 * kept for the role that provides the store; this interface only ever cares
 * that it can hand back an id, so it is named for what it actually is.
 *
 * **Breaking in 2.0.0**: this port and the `session` option key it is passed
 * as were both renamed. The names 1.1.0 exported for them are gone from the
 * public surface — see {@link CsrfGuardOptions.identity}.
 */
export interface IdentityPort {
  load(jar: unknown): Promise<{ id: string }>;
}

export interface CsrfGuardOptions<Ctx> {
  /**
   * What the token must be bound to. Give `identity` instead to bind to the
   * id it loads, which is the usual choice.
   */
  bind?(context: Ctx): Promisable<string>;
  /**
   * Binds to the id this identity provider loads — through {@link cookieJar}.
   *
   * **Breaking in 2.0.0**: this key was `session` in 1.1.0. `csrfGuard(C, {
   * session: X })` binds nothing now — with no `bind` beside it, it throws a
   * `TypeError` the moment the middleware is built, at the app's module
   * level, not on the first request. Rename the key to `identity`; the
   * class you pass is unchanged.
   */
  identity?: ClassType<IdentityPort>;
  /** The token's purpose, when it is a form's own rather than the request token. */
  purpose?: string;
  /** Message the 403 carries. */
  message?: string;
}

/**
 * Refuses a request whose origin says it came from another site.
 *
 * **The decision is not this package's.** `@ecosy/next` ships no origin
 * policy, no allow-list and no header parsing of its own: every `true` or
 * `false` comes out of the `Csrf` class the app hands in. All this function
 * adds is the wiring — call it on each request, turn a `false` into
 * {@link Forbidden}.
 *
 * The cheapest check there is — no token, no secret, no body — so it belongs in
 * the proxy, in front of everything:
 *
 * ```ts
 * export const proxy = Gateway({}).use(csrfOrigin(AppCsrf));
 * ```
 *
 * Throws {@link Forbidden}, which a Gateway and a Route both turn into a 403.
 */
export function csrfOrigin<Ctx extends { req: Request }>(Csrf: CsrfPortClass, message = "Cross-site request refused") {
  return (context: Ctx): void => {
    if (!new Csrf().origin(context.req)) {
      throw new Forbidden(message, { errorCode: "csrf_origin" });
    }
  };
}

/**
 * Refuses a request without a valid CSRF token.
 *
 * **This package does not implement CSRF, and calling this is not, by
 * itself, protection.** There is no token generation here, no comparison and
 * no secret read — not in this function and not anywhere in `@ecosy/next`.
 * Every one of those decisions is made inside the `Csrf` class the app
 * passes in (`@ecosy/core/csrf` is one such module). What this function adds
 * is the Next-shaped half: work out what the token is bound to (from
 * `bind`, or from the id `identity` loads out of a {@link cookieJar}), call
 * `check()` once per request, and turn a refusal into {@link Forbidden},
 * which a Gateway and a Route both render as a 403. Give it a `Csrf` whose
 * `check()` answers `true` to everything and this middleware is a no-op on
 * every request — nothing here can notice that, and no test in this package
 * will tell you. A guarded route is only as guarded as the module you
 * brought.
 *
 * In a Route, where the body is readable and the session is at hand:
 *
 * ```ts
 * export const POST = Route()
 *   .use(csrfGuard(AppCsrf, { identity: AppSession }))
 *   .post(async (ctx) => …);
 * ```
 *
 * The check lets through what needs no token: a safe method, and — when the
 * CSRF module is given `statefulOrigins` — a request that is not the front
 * end's, an API client with a bearer token among them.
 */
export function csrfGuard<Ctx extends { req: Request }>(Csrf: CsrfPortClass, options: CsrfGuardOptions<Ctx>) {
  if (!options.bind && !options.identity) {
    throw new TypeError("[Ecosy] csrfGuard needs `bind` or `identity`");
  }

  return async (context: Ctx): Promise<void> => {
    const bind = options.bind
      ? await options.bind(context)
      : (await new options.identity!().load(await cookieJar(context as unknown as CookieForwarding))).id;

    const ok = await new Csrf().check(context.req, { bind, purpose: options.purpose });

    if (!ok) {
      throw new Forbidden(options.message ?? "Invalid CSRF token", { errorCode: "csrf_token" });
    }
  };
}

/** The context a middleware built here needs: Next's request. */
export type CsrfContext = Pick<Context, "req">;
