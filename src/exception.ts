export interface ErrorIssue {
  code?: string;
  path: (string | number)[];
  message: string;
}

export interface ErrorShape {
  message?: string;
  issues?: ErrorIssue[];
  errorCode?: string;
}

export class Exception<E = ErrorShape> {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly error: E,
    public readonly headers: Record<string, string> = {}
  ) {}
}

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
