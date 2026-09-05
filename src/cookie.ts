import "server-only";
import { cookies } from "next/headers";
import { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { IS_PROD } from "./utils";

/**
 * Cookie access with defaults that suit a session cookie.
 *
 * Server-only — the module imports `server-only`, so reaching for it from a
 * client component is a build error rather than a runtime one.
 */
export class Cookie {
  /**
   * Reads a cookie.
   *
   * @param name - Cookie name.
   * @returns Its value, or `null` when it is not set.
   */
  static async get(name: string): Promise<string | null> {
    const cookieStore = await cookies();
    return cookieStore.get(name)?.value || null;
  }

  /**
   * Writes a cookie, defaulting to `httpOnly`, `sameSite: "lax"`, `path: "/"`,
   * and `secure` only in production — so a cookie still sets over plain HTTP
   * in development. Every default is overridable through `options`.
   *
   * @example
   * await Cookie.set("session", token, { maxAge: 3600 });
   *
   * @param name - Cookie name.
   * @param value - Value to store.
   * @param options - Overrides merged over the defaults.
   */
  static async set(name: string, value: string, options?: Partial<ResponseCookie>): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(name, value, Object.assign({
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      path: "/",
    }, options));
  }

  /**
   * Removes a cookie.
   *
   * @param name - Cookie name.
   */
  static async delete(name: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(name);
  }

  /**
   * Whether a cookie is present, without reading its value.
   *
   * @param name - Cookie name.
   */
  static async has(name: string): Promise<boolean> {
    const cookieStore = await cookies();
    return cookieStore.has(name);
  }
}
