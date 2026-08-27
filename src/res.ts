import { NextResponse } from "next/server";
import { HttpResponse } from "@ecosy/http";
import { CONTENT_TYPES } from "./content-type";
import { NextURL } from "next/dist/server/web/next-url";
import { MiddlewareResponseInit } from "./types";

export class Res {
  static X_POWERED_BY = "Ecosy";

  private static getDefaultHeaders(contentType: string) {
    return {
      "Content-Type": contentType,
      "X-Powered-By": Res.X_POWERED_BY,
    };
  }

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

  static text(body: string, status: number = 200, extraHeaders: Record<string, string> = {}) {
    return new NextResponse(body, {
      status,
      headers: {
        ...Res.getDefaultHeaders(CONTENT_TYPES.text),
        ...extraHeaders,
      }
    });
  }

  static next(init?: MiddlewareResponseInit) {
    return NextResponse.next(init);
  }

  static redirect(url: string | NextURL, init?: number | ResponseInit) {
    return NextResponse.redirect(url, init);
  }

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
