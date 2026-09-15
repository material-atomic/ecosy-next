const KEY_STORE = Symbol.for("@ecosy/next:request-key");

interface KeyHolder {
  key: Promise<CryptoKey>;
  /** Whether this process has issued an id — what tells a forged id from another process's. */
  minted: boolean;
}

type Holder = typeof globalThis & { [KEY_STORE]?: KeyHolder };

/* The key is 32 random bytes made the first time it is needed, never
   configured: nobody can be asked to invent a secret for an id that only has to
   survive the hop from proxy to route, and a secret that is never written down
   cannot leak from a repository or an environment file. Restarting the process
   invalidates every outstanding id, which costs nothing — none outlives a request.

   Web Crypto rather than `node:crypto`, so a module that reaches this compiles
   for the edge runtime as well. */
function keyHolder(): KeyHolder {
  const holder = globalThis as Holder;
  if (!holder[KEY_STORE]) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    Object.defineProperty(holder, KEY_STORE, {
      value: {
        key: crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
        minted: false,
      } satisfies KeyHolder,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
  return holder[KEY_STORE]!;
}

const encoder = new TextEncoder();
const SHAPE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * A new request id: a random UUID and its HMAC under this process's key, as
 * `<uuid>.<signature>`. Signed, not encrypted — the id hides nothing; what it
 * proves is that this process issued it.
 */
export async function mintRequestId(): Promise<string> {
  const holder = keyHolder();
  holder.minted = true;
  const nonce = crypto.randomUUID();
  const signature = await crypto.subtle.sign("HMAC", await holder.key, encoder.encode(nonce));
  return `${nonce}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * - `"valid"`: this process issued it.
 * - `"invalid"`: malformed, or a signature this process's key did not make.
 * - `"foreign"`: well-formed, but this process has issued no id at all — the
 *   proxy runs somewhere else (the edge runtime, another instance), or the id
 *   was made up before any real one existed.
 */
export type RequestIdCheck = "valid" | "invalid" | "foreign";

/** Checks an id against this process's key, in constant time. */
export async function checkRequestId(value: string | null): Promise<RequestIdCheck> {
  const match = value ? SHAPE.exec(value) : null;
  if (!match) return "invalid";

  const holder = (globalThis as Holder)[KEY_STORE];
  if (!holder?.minted) return "foreign";

  const valid = await crypto.subtle.verify("HMAC", await holder.key, fromBase64Url(match[2]!), encoder.encode(match[1]!));
  return valid ? "valid" : "invalid";
}
