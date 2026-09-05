/** One field-level problem, as produced by a schema validator. */
export interface ErrorIssue {
  code?: string;
  path: (string | number)[];
  message: string;
}

/** The `error` payload carried by an {@link Exception} and echoed in the response envelope. */
export interface ErrorShape {
  message?: string;
  issues?: ErrorIssue[];
  errorCode?: string;
}

/**
 * Throw a status, get a response. {@link Route} catches these and turns them
 * into the response envelope with the status they carry, so a handler can bail
 * out anywhere without threading an error back to the caller.
 *
 * Note that this does **not** extend `Error` — there is no stack trace, and
 * `err instanceof Error` is `false`. It is a value describing a response, not a
 * fault.
 *
 * Each subclass fixes `status` and `statusText` and accepts either form:
 *
 * @example
 * throw new NotFound("No such user");
 * throw new BadRequest("Invalid body", { issues });
 * throw new TooManyRequests({ message: "Slow down" }, { "retry-after": "60" });
 *
 * @template E - The shape of the `error` payload.
 */
export class Exception<E = ErrorShape> {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly error: E,
    public readonly headers: Record<string, string> = {}
  ) {}
}

/** Throws 500 Internal Server Error. Takes the same arguments as any {@link Exception} subclass. */
export class InternalServer extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Internal Server Error", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(500, "Internal Server Error", finalShape, headers);
  }
}

/** Throws 400 Bad Request. Takes the same arguments as any {@link Exception} subclass. */
export class BadRequest extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Bad Request", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(400, "Bad Request", finalShape, headers);
  }
}

/** Throws 401 Unauthorized. Takes the same arguments as any {@link Exception} subclass. */
export class Unauthorized extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Unauthorized", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(401, "Unauthorized", finalShape, headers);
  }
}

/** Throws 403 Forbidden. Takes the same arguments as any {@link Exception} subclass. */
export class Forbidden extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Forbidden", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(403, "Forbidden", finalShape, headers);
  }
}

/** Throws 404 Not Found. Takes the same arguments as any {@link Exception} subclass. */
export class NotFound extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Not Found", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(404, "Not Found", finalShape, headers);
  }
}

/** Throws 405 Method Not Allowed. Takes the same arguments as any {@link Exception} subclass. */
export class MethodNotAllowed extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Method Not Allowed", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(405, "Method Not Allowed", finalShape, headers);
  }
}

/** Throws 408 Request Timeout. Takes the same arguments as any {@link Exception} subclass. */
export class RequestTimeout extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Request Timeout", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(408, "Request Timeout", finalShape, headers);
  }
}

/** Throws 409 Conflict. Takes the same arguments as any {@link Exception} subclass. */
export class Conflict extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Conflict", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(409, "Conflict", finalShape, headers);
  }
}

/** Throws 410 Gone. Takes the same arguments as any {@link Exception} subclass. */
export class Gone extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Gone", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(410, "Gone", finalShape, headers);
  }
}

/** Throws 413 Payload Too Large. Takes the same arguments as any {@link Exception} subclass. */
export class PayloadTooLarge extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Payload Too Large", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(413, "Payload Too Large", finalShape, headers);
  }
}

/** Throws 415 Unsupported Media Type. Takes the same arguments as any {@link Exception} subclass. */
export class UnsupportedMediaType extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Unsupported Media Type", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(415, "Unsupported Media Type", finalShape, headers);
  }
}

/** Throws 422 Unprocessable Entity. Takes the same arguments as any {@link Exception} subclass. */
export class UnprocessableEntity extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Unprocessable Entity", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(422, "Unprocessable Entity", finalShape, headers);
  }
}

/** Throws 429 Too Many Requests. Takes the same arguments as any {@link Exception} subclass. */
export class TooManyRequests extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Too Many Requests", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(429, "Too Many Requests", finalShape, headers);
  }
}

/** Throws 501 Not Implemented. Takes the same arguments as any {@link Exception} subclass. */
export class NotImplemented extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Not Implemented", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(501, "Not Implemented", finalShape, headers);
  }
}

/** Throws 502 Bad Gateway. Takes the same arguments as any {@link Exception} subclass. */
export class BadGateway extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Bad Gateway", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(502, "Bad Gateway", finalShape, headers);
  }
}

/** Throws 503 Service Unavailable. Takes the same arguments as any {@link Exception} subclass. */
export class ServiceUnavailable extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Service Unavailable", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(503, "Service Unavailable", finalShape, headers);
  }
}

/** Throws 504 Gateway Timeout. Takes the same arguments as any {@link Exception} subclass. */
export class GatewayTimeout extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Gateway Timeout", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(504, "Gateway Timeout", finalShape, headers);
  }
}

/** Throws 507 Insufficient Storage. Takes the same arguments as any {@link Exception} subclass. */
export class InsufficientStorage extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Insufficient Storage", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(507, "Insufficient Storage", finalShape, headers);
  }
}

/** Throws 508 Loop Detected. Takes the same arguments as any {@link Exception} subclass. */
export class LoopDetected extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Loop Detected", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(508, "Loop Detected", finalShape, headers);
  }
}

/** Throws 510 Not Extended. Takes the same arguments as any {@link Exception} subclass. */
export class NotExtended extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Not Extended", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(510, "Not Extended", finalShape, headers);
  }
}

/** Throws 511 Network Authentication Required. Takes the same arguments as any {@link Exception} subclass. */
export class NetworkAuthenticationRequired extends Exception<ErrorShape> {
  constructor(shape: ErrorShape, headers?: Record<string, string>);
  constructor(message?: string, otherShape?: Omit<ErrorShape, "message">, headers?: Record<string, string>);
  constructor(arg1?: string | ErrorShape, arg2?: Record<string, string> | Omit<ErrorShape, "message">, arg3?: Record<string, string>) {
    let finalShape: ErrorShape;
    let headers: Record<string, string> = {};

    if (typeof arg1 === "string" || arg1 === undefined) {
      finalShape = { message: arg1 || "Network Authentication Required", ...(arg2 as Record<string, unknown>) };
      headers = (arg3 as Record<string, string>) || {};
    } else {
      finalShape = arg1;
      headers = (arg2 as Record<string, string>) || {};
    }

    super(511, "Network Authentication Required", finalShape, headers);
  }
}
