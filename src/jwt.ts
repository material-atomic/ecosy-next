import jwt from "jsonwebtoken";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";

/** Configuration for {@link Jwt}. */
export interface JwtConfig {
  secret: string;
  issuer?: string;
  accessKey?: string;
}

/**
 * Reads a bearer token off a request, verifies it, signs a new one — a
 * configured wrapper over `jsonwebtoken`.
 *
 * `jsonwebtoken` is an **optional peer dependency**: nothing else in the
 * package touches it, so only apps importing `@ecosy/next/jwt` need it
 * installed, along with `@types/jsonwebtoken` to typecheck against this module.
 *
 * Returns a class rather than an instance, so it drops straight into an
 * {@link InjectMap}.
 *
 * @example
 * export const AppJwt = Jwt({ secret: process.env.JWT_SECRET!, issuer: "MyApp" });
 *
 * export const GET = Route({ jwt: AppJwt }).get(async (ctx) => {
 *   const token = ctx.jwt.extractFromHeader(ctx.req.headers);
 *   const payload = token ? ctx.jwt.verify(token) : null;
 *   if (!payload) throw new Unauthorized("Bad token");
 *   return { userId: payload.sub };
 * });
 *
 * @param configs - Secret, expected issuer and default cookie name.
 * @returns A class constructible with no arguments.
 */
export function Jwt(configs: JwtConfig) {
  const { secret, accessKey = "access_token", issuer } = configs;

  return class JwtHelper {
    /**
     * Pulls the token out of `Authorization: Bearer <token>`. Does **not**
     * verify it — pass the result to {@link verify}.
     *
     * @param headers - The request headers.
     * @returns The token, or `null` when the header is missing, uses another
     * scheme, or is not exactly two space-separated parts.
     */
    extractFromHeader(headers: Headers) {
      const authorization = headers.get("authorization");

      if (!authorization || !authorization.startsWith("Bearer ") || authorization.split(" ").length !== 2) {
        return null;
      }

      return authorization.split(" ")[1]
    }

    /**
     * Reads a token from a cookie.
     *
     * @param cookies - Next's request-side cookies — `request.cookies`, not the
     * `cookies()` helper.
     * @param key - Cookie name. Defaults to the configured `accessKey`, so a
     * refresh cookie is read by naming it.
     * @returns The value, or `null`.
     */
    extractFromCookie(cookies: RequestCookies, key = accessKey) {
      return cookies.get(key)?.value ?? null;
    }

    /**
     * Verifies a token.
     *
     * **Never throws**: a bad signature, an expired token and a failed claim
     * are all `null`, so there is no way to tell *expired* from *forged* here.
     *
     * Only `sub` and — when an `issuer` was configured — `iss` are checked.
     * Any claim of your own, a token type included, is yours to check on the
     * returned payload.
     *
     * @param token - The encoded token.
     * @returns The payload when it holds, `null` otherwise.
     */
    verify(token: string) {
      try {
        const payload = jwt.verify(token, secret);

        if (!payload || typeof payload !== "object") {
          return null;
        }

        const validPayload = [
          !issuer || payload.iss === issuer,
          typeof payload.sub === "string" && payload.sub.length > 0
        ];

        if (!validPayload.every((isValid) => isValid)) {
          return null;
        }

        return payload;
      } catch {
        return null;
      }
    }

    /**
     * Parses a payload **without verifying the signature** and casts it.
     *
     * For reading a claim off a token you are not authorising with — the `sub`
     * of an already-expired token, say. Never branch on it for access.
     *
     * @template Payload - The assumed shape. Unchecked.
     * @param token - The encoded token.
     */
    decode<Payload>(token: string) {
      return jwt.decode(token) as Payload;
    }

    /**
     * Signs a payload with the configured secret.
     *
     * The configured `issuer` is **not** applied for you, so a token signed
     * without one is rejected by this same helper's {@link verify}. Pass it
     * through `options`, or put `iss` in the payload.
     *
     * @example
     * helper.sign({ sub: userId }, { issuer: "MyApp", expiresIn: "15m" });
     *
     * @param payload - Claims to sign.
     * @param options - Passed to `jsonwebtoken` untouched.
     */
    sign(payload: string | object | Buffer, options?: jwt.SignOptions) {
      return jwt.sign(payload, secret, options);
    }
  }
}