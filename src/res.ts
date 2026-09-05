import { NextResponse } from "next/server";
import { CONTENT_TYPES } from "./content-type";
import { NextURL } from "next/dist/server/web/next-url";
import { MiddlewareResponseInit } from "./types";

/** The envelope {@link Route} wraps a handler's return value in. */
export interface HttpResponse<T = unknown, E = unknown> {
  success: boolean;
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  error: E | null;
}

/**
 * Response constructors, each stamping `Content-Type` and `X-Powered-By`.
 *
 * Also reachable as `ctx.res` inside a handler.
 */
export class Res {
  static X_POWERED_BY = "Ecosy";

  private static getDefaultHeaders(contentType: string) {
    return {
      "Content-Type": contentType,
      "X-Powered-By": Res.X_POWERED_BY,
    };
  }

  /**
   * A JSON response.
   *
   * A payload carrying `status` or `headers` of its own — an {@link HttpResponse},
   * for instance — takes them from there, so `status` acts as the fallback
   * rather than the final say.
   *
   * @param payload - Body to serialise.
   * @param status - Status to use when the payload does not carry one. Defaults to `200`.
   * @param extraHeaders - Merged last, over both the defaults and the payload's own.
   */
  static json(payload: HttpResponse<unknown, unknown> | Record<string, unknown>, status: number = 200, extraHeaders: Record<string, string> = {}) {
    const headers = {
      ...Res.getDefaultHeaders(CONTENT_TYPES.json),
      ...(typeof payload === 'object' && payload !== null && 'headers' in payload ? (payload as Record<string, unknown>).headers as Record<string, string> : {}),
      ...extraHeaders,
    };
    
    return NextResponse.json(payload, {
      status: (typeof payload === 'object' && payload !== null && 'status' in payload ? (payload as Record<string, unknown>).status as number : status) || status,
      headers,
    });
  }

  /**
   * A `text/plain` response.
   *
   * @param body - Response body.
   * @param status - Defaults to `200`.
   * @param extraHeaders - Merged over the defaults.
   */
  static text(body: string, status: number = 200, extraHeaders: Record<string, string> = {}) {
    return new NextResponse(body, {
      status,
      headers: {
        ...Res.getDefaultHeaders(CONTENT_TYPES.text),
        ...extraHeaders,
      }
    });
  }

  /**
   * Continues to the next middleware or the route itself, optionally rewriting
   * the request. Only meaningful inside a {@link Proxy}.
   *
   * @param init - Response init, optionally carrying modified request headers.
   */
  static next(init?: MiddlewareResponseInit) {
    return NextResponse.next(init);
  }

  /**
   * A redirect.
   *
   * @param url - Destination.
   * @param init - Status code, or a full response init. Defaults to `307`.
   */
  static redirect(url: string | NextURL, init?: number | ResponseInit) {
    return NextResponse.redirect(url, init);
  }

  /**
   * An `application/javascript` response, for serving a script from a route.
   *
   * @param body - Script source.
   * @param status - Defaults to `200`.
   * @param extraHeaders - Merged over the defaults.
   */
  static javascript(body: string, status: number = 200, extraHeaders: Record<string, string> = {}) {
    return new NextResponse(body, {
      status,
      headers: {
        ...Res.getDefaultHeaders(CONTENT_TYPES.javascript),
        ...extraHeaders,
      }
    });
  }
}
