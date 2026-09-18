import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

/** Attributes for a cookie. `maxAge` is in seconds, as `Set-Cookie` has it. */
export interface CookieJarOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
}

/**
 * Reads and writes cookies for one request.
 *
 * The shape session and CSRF modules take — `@ecosy/core/session` and
 * `@ecosy/core/csrf` among them — declared here rather than imported, so this
 * package depends on none of them. Anything with these three methods fits.
 */
export interface CookieJar {
  get(name: string): string | null | undefined;
  set(name: string, value: string, options: CookieJarOptions): Promise<void>;
  delete(name: string, options: CookieJarOptions): Promise<void>;
}

/** What a jar needs from a proxy's context to hand cookies on to the route. */
export interface CookieForwarding {
  readonly req: NextRequest;
  setHeader(name: string, value: string): void;
}

function serialiseCookieHeader(values: Map<string, string | null>, original: string | null): string {
  const pairs = new Map<string, string>();

  for (const part of (original ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    pairs.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }

  for (const [name, value] of values) {
    if (value === null) pairs.delete(name);
    else pairs.set(name, value);
  }

  return [...pairs].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * A {@link CookieJar} over Next's `cookies()`.
 *
 * - **Route handler**: reads the request's cookies, writes `Set-Cookie`.
 * - **Proxy**: pass its context. Writes still reach the response, and are
 *   also written into the request headers the proxy forwards — measured on
 *   Next 16.3.4, a cookie set in a proxy through `cookies()` is otherwise not
 *   seen by the route serving the same request, so a session created in the
 *   proxy would be created again in the route.
 * - **Server Component**: reads only. Next refuses writes there; a session or
 *   CSRF module that writes from a page throws Next's own error.
 *
 * Passing the context is what makes the proxy case work; leaving it out
 * fails quietly. `cookieJar()` with no argument still compiles in a
 * proxy and still writes `Set-Cookie`, but the route serving the same
 * request sees nothing — the exact problem this exists to solve, back
 * again with no warning.
 *
 * Each call builds its own jar. A second `cookieJar()` in the same
 * request does not see what the first one wrote; it reads the request's
 * own cookies again.
 *
 * Within one jar a value written is read back at once, before any response.
 *
 * ```ts
 * const session = await new AppSession().load(await cookieJar());
 * // in a proxy:
 * const session = await new AppSession().load(await cookieJar(ctx));
 * ```
 */
export async function cookieJar(forwarding?: CookieForwarding): Promise<CookieJar> {
  const store = await cookies();
  /* Written in this jar: a value, or null for deleted. Read before the store,
     whose view of the request does not change when a response cookie does. */
  const written = new Map<string, string | null>();

  const forward = () => {
    if (!forwarding) return;
    forwarding.setHeader("cookie", serialiseCookieHeader(written, forwarding.req.headers.get("cookie")));
  };

  return {
    get(name) {
      if (written.has(name)) return written.get(name);
      return store.get(name)?.value ?? null;
    },

    async set(name, value, options) {
      store.set(name, value, options);
      written.set(name, value);
      forward();
    },

    async delete(name, options) {
      store.set(name, "", { ...options, maxAge: 0 });
      written.set(name, null);
      forward();
    },
  };
}
