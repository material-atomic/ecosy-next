# Changelog

## 2.0.0

2.0.0 gỡ hẳn `Instrument` (kiến trúc không ai dùng, và có lỗi), đổi cổng nhận
danh tính cho CSRF từ `SessionPort` sang `IdentityPort`, và — chỉ với người
đang ở nhánh `1.0.x` — lần đầu thêm cổng cookie (`cookieJar`) và chỗ cắm CSRF
vào Next. Hai đường nâng cấp không đọc CHANGELOG này giống nhau: người ở
`1.0.x` chưa từng thấy `cookieJar`/CSRF nên với họ cả khối đó là **thêm mới**,
không có gì phá tương thích; người ở `1.1.0` đã có sẵn cả hai, và với họ thứ
duy nhất phá tương thích trên bề mặt tên là `Instrument` biến mất và
`SessionPort` đổi tên.

### Nâng cấp từ 1.0.x

#### Breaking

| Cái gì đổi | Nguồn |
|---|---|
| `Instrument` gỡ hẳn: bảy tên biến mất khỏi entry gốc — `Instrument`, `InstrumentBase`, `IInstrumentBuilder`, `InstrumentConfig`, `InstrumentHandler`, `InstrumentErrorHandler`, `InstrumentParam`. `import { Instrument }` vỡ lúc biên dịch. Thay bằng gọi `bootstrap.init()` thẳng trong `register()` của `instrumentation.ts`. | `895a9e6` + task 0030 |

Ví dụ thay thế:

```ts
export const bootstrap = Bootstrap({})
  .register("db", async () => DataSource.entities([User]).initialize(config))
  .register("schedule", async () => new AppSchedule().start())
  .start(async () => console.log("ready"));

// instrumentation.ts
export async function register() {
  await bootstrap.init();
}
```

<!-- surface:removed-from-1.0.x -->
`IInstrumentBuilder`, `Instrument`, `InstrumentBase`, `InstrumentConfig`,
`InstrumentErrorHandler`, `InstrumentHandler`, `InstrumentParam`
<!-- /surface:removed-from-1.0.x -->

#### Added

| Cái gì | Nguồn |
|---|---|
| `cookieJar(ctx?)` — cổng cookie đọc/ghi cho Route, Proxy và Server Component qua `next/headers`. Một cookie đặt ở Proxy được route cùng request đọc lại ngay, không đợi round-trip qua browser. Bốn tên: `cookieJar`, `CookieJar`, `CookieJarOptions`, `CookieForwarding`. | task 0024 |
| Chỗ cắm CSRF vào Next — bảy tên: `csrfOrigin`, `csrfGuard`, `CsrfPort`, `CsrfPortClass`, `IdentityPort`, `CsrfGuardOptions`, `CsrfContext`. Gói **không** ship một hiện thực CSRF hay session nào; cả hai vẫn là việc của app. | task 0025 |
| `ContextValues` — kiểu của `values` khi dựng `Context` bằng tay. | task 0023 |

<!-- surface:added-since-1.0.x -->
`ContextValues`, `CookieForwarding`, `CookieJar`, `CookieJarOptions`,
`CsrfContext`, `CsrfGuardOptions`, `CsrfPort`, `CsrfPortClass`, `IdentityPort`,
`cookieJar`, `csrfGuard`, `csrfOrigin`
<!-- /surface:added-since-1.0.x -->

### Nâng cấp từ 1.1.0

#### Breaking

| Cái gì đổi | Nguồn |
|---|---|
| `Instrument` gỡ hẳn — cùng bảy tên và cùng lý do ở trên (mục "Nâng cấp từ 1.0.x"). | `895a9e6` + task 0030 |
| `SessionPort` → `IdentityPort`, và khoá `csrfGuard({ session })` → `{ identity }`. Cả hai là API công khai của 1.1.0 qua `export * from "./csrf"` trên entry gốc. Lý do: cổng đó trả về một id để buộc token vào — nó cung cấp danh tính, không phải kho — và chữ "Session" để dành cho vai kho. | task 0025 |

**Dòng di trú, chép-dán được** (task 0025):

```diff
- import type { SessionPort } from "@ecosy/next";
+ import type { IdentityPort } from "@ecosy/next";

- csrfGuard(AppCsrf, { session: AppSession })
+ csrfGuard(AppCsrf, { identity: AppSession })
```

Class truyền vào KHÔNG đổi: `SessionPort` (1.1.0) và `IdentityPort` (2.0.0)
cùng một thân, `load(jar: unknown): Promise<{ id: string }>`. Chỉ tên kiểu và
tên khoá đổi.

**XOÁ khoá `session`, đừng chỉ thêm `identity` bên cạnh nó.** Một object mang
cả hai (`{ identity: New, session: Old }`) biên dịch sạch, chạy đúng bằng
`identity`, và nuốt `session` không một tín hiệu nào.

Đo được ba bề mặt hỏng khác nhau bằng chính `tsc 7.0.2 --strict` của repo trên
`dist/*.d.ts`. Import tên cũ (`import type { SessionPort }`) là `TS2305`.
`csrfGuard(C, { session: X })` viết thẳng tại lời gọi, dưới dạng object
literal, là `TS2353` (excess property check). Nhưng ngay khi cùng object đó
nằm trong một **biến** mang thêm bất kỳ khoá hợp lệ nào — `purpose`,
`message`, hay `bind` bên cạnh `session` — TypeScript không nói gì:
`const o = { session: X, purpose: "p" }; csrfGuard(C, o)` biên dịch sạch, vì
excess-property-check chỉ bắn trên literal tại lời gọi và weak-type-check tắt
ngay khi biến có thêm một khoá hợp lệ. App biên dịch xong, rồi ném
`` TypeError: [Ecosy] csrfGuard needs `bind` or `identity` `` lúc nạp module —
ở tầng module của app, không phải ở request đầu tiên. Thông điệp đó không nhắc
chữ `session` (1.1.0 ném đúng cùng kiểu, cùng câu, chỉ khác một chữ:
`` needs `bind` or `session` ``), nên nó không tự nói ra rằng khoá vừa đổi tên. Và với
`{ identity: New, session: Old }`: không ném gì cả, chạy đúng `identity`, nuốt
`session` — hình dạng im lặng lúc chạy duy nhất tìm được, chỉ lộ ra khi hai
class khác nhau. `{ bind, session: X }` không ném và `bind` thắng — **giống
hệt hành vi của 1.1.0** (đo trên `dist/csrf.mjs` đã phát hành); đó không phải
một thay đổi.

<!-- surface:removed-from-1.1.0 -->
`IInstrumentBuilder`, `Instrument`, `InstrumentBase`, `InstrumentConfig`,
`InstrumentErrorHandler`, `InstrumentHandler`, `InstrumentParam`, `SessionPort`
<!-- /surface:removed-from-1.1.0 -->

#### Added

| Cái gì | Nguồn |
|---|---|
| `IdentityPort` — thay `SessionPort`, thân không đổi. | task 0025 |
| `ContextValues` — kiểu của `values` khi dựng `Context` bằng tay. | task 0023 |

<!-- surface:added-since-1.1.0 -->
`ContextValues`, `IdentityPort`
<!-- /surface:added-since-1.1.0 -->

### Thay đổi hành vi (cả hai đường đều gặp)

#### Changed

| Cái gì | Nguồn |
|---|---|
| Token dùng chung vòng đời: một instance mỗi class mỗi lớp Next, không phải một per request. Khoá `Bootstrap` đổi. | `1225854` |
| `x-ecosyrequest-id` đổi hình dạng: từ UUID trần thành `<uuid>.<43 ký tự base64url>`, có chữ ký. | `1225854` |
| Proxy luôn tự cấp id mới; id client gửi không bao giờ được dùng lại. Id không hợp lệ dẫn tới **400 trước mọi middleware**. | `1225854` |
| Route từ chối id không do tiến trình này cấp — ba lý do khác nhau, ba thông điệp. Caller nào đang tự đặt header bằng tay để gọi thẳng API route sẽ vỡ. | `1225854` |
| `ctx.next()` không đối số nay chuyển tiếp header dựa trên `this.init.request.headers` — mọi `setHeader`/`delete` một middleware đã làm đi ra đúng như vậy. Trước đây chỉ header client gửi nguyên vẹn mới chắc chắn đi ra. Header một app nhìn thấy ở Route sẽ khác trước. | task 0023, `db3c75d` |
| Handoff Proxy→Route đi qua một kho có trần 10 000 entry và TTL 60 giây, thay cho một `Map` process-wide không giới hạn. | `1225854` |
| Khoá của `ctx.set`/`ctx.get` không còn với tới prototype của cái túi. Trước đó `set("__proto__", …)` làm mọi khoá chưa ai đặt bắt đầu trả lời, `destroy()` không dọn được, và cái túi bị đầu độc đi xuyên Proxy→Route. | task 0022 |

#### Fixed

> Một `Context` dựng bằng tay với `values.local` chứa khoá trần — không có tiền
> tố `$` — nay đọc được đúng giá trị đó: constructor cộng tiền tố **tại chỗ,
> trên chính object seed người gọi truyền vào**, không phải trên một bản sao.
> Ai đang giữ tham chiếu tới object đó sẽ thấy khoá của nó bị đổi tên (`userId`
> → `$userId`); một test khẳng định `Object.keys(seed)` sẽ vỡ. Khi cả hai dạng
> cùng có mặt (`{ userId: "u1", $userId: "u2" }`) thì bản có tiền tố thắng và
> bản trần bị xoá. Một object seed **không dùng lại được cho hai `Context`** —
> chúng dùng chung một cái túi suốt đời, và `destroy()` của cái này dọn rỗng
> cái kia. Dựng object mới cho mỗi context. *(nguồn: task 0023, `db3c75d`)*

## 1.1.0 (2026-09-18)

Two adapters, so a session or CSRF module — `@ecosy/core/session` and
`@ecosy/core/csrf`, or anything of that shape — drops into a Next app. Both
declare what they need as types of their own: this package depends on nothing
but Next.

### Features

- **`cookieJar(ctx?)`**: a cookie jar over Next's `cookies()`. In a route
  handler it reads the request's cookies and writes `Set-Cookie`. In a proxy,
  given its context, it does that and also writes into the request headers the
  proxy forwards — measured on Next 16.3.4, a cookie set in a proxy is
  otherwise not seen by the route serving the same request, so a session
  created there would be created again. In a Server Component it reads; Next
  refuses writes there itself.
- **`csrfOrigin(Csrf)`**: refuses a state-changing request whose origin says it
  came from another site. No token, no secret, no body — it belongs in the
  proxy, in front of everything.
- **`csrfGuard(Csrf, { session })`** or **`{ bind }`**: refuses a request
  without a valid token, binding it to the session id by default. Safe methods
  and requests that are not the front end's — an API client with a bearer
  token, say — are let through by the check itself.

1.1.0 closed the same per-request state problem 2.0.0 also closes, but by a
different route: it moved the bag onto the `Context` **instance** itself
(`private readonly bag = new Map<string, unknown>()`, cleared by `destroy()`)
instead of a process-wide store, which removes the Proxy→Route handoff
entirely. 2.0.0 does not take that route — it **keeps** the handoff and closes
the same hole with a signed request id plus a bounded store (10,000 entries,
60s TTL) instead.

## 1.0.2

### Fixes

- **`Proxy`**: building a proxy marks the app as proxied, not importing the
  module. The root entry re-exports it, so importing `Route` alone used to mark
  an app proxied even when it had none, and every one of its routes then failed
  on a header nothing was there to set.

  Published from a machine whose commit was lost; rebuilt from the published
  source map and committed on the 1.x branch on 2026-09-17.
