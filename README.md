# @ecosy/next

Adapters for building a Next.js app on `Route` and `Gateway`: a request context
shared across both, a cookie jar that works in a proxy, and the Next-shaped
half of CSRF and identity checks. The package depends on nothing but Next —
session and CSRF implementations stay in the app.

Documentation: **[docs.ecosy.io/next](https://docs.ecosy.io/next)**

<!-- readme:api -->
`Route`, `Gateway`, `Context`, `ContextValues`, `cookieJar`, `CookieJar`,
`CookieJarOptions`, `CookieForwarding`, `csrfOrigin`, `csrfGuard`, `CsrfPort`,
`CsrfPortClass`, `IdentityPort`, `CsrfGuardOptions`, `CsrfContext`
<!-- /readme:api -->

## Installation

```bash
yarn add @ecosy/next
```

Peer dependencies: `next ^16.3.1` (required). `jsonwebtoken ^9.0.3` is
**optional** — only needed by `@ecosy/next/jwt`.

## Entry points

| Entry | What it needs |
|---|---|
| `@ecosy/next` | Next only |
| `@ecosy/next/inject` | Next only |
| `@ecosy/next/jwt` | `jsonwebtoken` |

`inject` stays off the root export so pulling in dependency injection is an
explicit choice. `jwt` stays off it so an app that never touches JWTs never
pulls `jsonwebtoken` into its bundle.

## Route

`Route` builds a Next route handler. `ctx.get`/`ctx.set` hand a value from one
middleware to the next, or across a `Gateway` → `Route` boundary, for the rest of
one request. Building a `Context` by hand instead of through `Route` takes its
seed values typed as `ContextValues`.

Values a `Gateway` sets travel to the `Route` serving the same request through a
bounded store (10,000 entries, 60 seconds), keyed by a signed request id the
proxy issues on every request — a client-supplied id is never trusted, and an
invalid one is rejected with a 400 before any middleware runs.

```ts
import { Route } from "@ecosy/next";

export const GET = Route().get((ctx) => {
  return { userId: ctx.get<string>("userId") };
});
```

## cookieJar

`cookieJar()` reads and writes cookies over Next's `cookies()`. In a route
handler or Server Component, call it with no argument. In a `Gateway`, pass its
context — otherwise a cookie set there compiles fine but is never seen by the
`Route` serving the same request, because the write never reaches the request
headers the proxy forwards.

```ts
import { cookieJar } from "@ecosy/next";

export async function GET() {
  const jar = await cookieJar();
  await jar.set("theme", "dark", { path: "/" });
  return Response.json({ theme: jar.get("theme") });
}
```

## CSRF

The package ships no CSRF or session implementation — `csrfOrigin` and
`csrfGuard` are wiring only, over a `CsrfPort` and an `IdentityPort` the app
supplies. `csrfOrigin` belongs in the proxy, ahead of everything, and needs no
token or secret: it only checks that the request's origin says it came from
this site. `csrfGuard` binds a token to the id an `IdentityPort` loads, under
the `identity` key — or to a custom value via `bind`, when there is no
identity to load from.

A `csrfGuard` whose `Csrf.check()` always answers `true` is a no-op: nothing
in this package can tell, and no test here will say so. The guard is only as
strong as the module passed in.

```ts
import { Route, Gateway, csrfOrigin, csrfGuard, type IdentityPort, type CsrfPort } from "@ecosy/next";

class AppCsrf implements CsrfPort {
  origin() { return true; }
  async check() { return true; }
}
class AppSession implements IdentityPort {
  async load() { return { id: "u1" }; }
}

export const proxy = Gateway({}).use(csrfOrigin(AppCsrf));
export const POST = Route()
  .use(csrfGuard(AppCsrf, { identity: AppSession }))
  .post(async () => Response.json({ ok: true }));
```

## Upgrading

From 1.1.0, rename the `session` option and the `SessionPort` type to
`identity` / `IdentityPort` — same class, same shape:

```diff
- import type { SessionPort } from "@ecosy/next";
+ import type { IdentityPort } from "@ecosy/next";

- csrfGuard(AppCsrf, { session: AppSession })
+ csrfGuard(AppCsrf, { identity: AppSession })
```

Remove the `session` key rather than leaving it beside `identity`. Written
straight at the call site TypeScript rejects `session` (TS2353); the same
object hoisted into a variable compiles clean, runs on `identity` alone and
drops `session` with no signal. Full detail, including the 1.0.x upgrade path
and the `Instrument` removal, is in `CHANGELOG.md`.

## Documentation

Package docs: [docs.ecosy.io/next](https://docs.ecosy.io/next). Everything
else Ecosy ships: [docs.ecosy.io](https://docs.ecosy.io).

## License

MIT
