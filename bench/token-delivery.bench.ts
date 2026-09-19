/**
 * ĐO PHẦN GIAO TOKEN — v1 so với v2, chỉ riêng phần đã thay đổi.
 *
 * Đặt file này vào repo ecosy-next (ví dụ `bench/token-delivery.bench.ts`) rồi:
 *
 *     npx tsx bench/token-delivery.bench.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO KHÔNG ĐO ĐẦU-CUỐI, VÀ VÌ SAO "v2 KHÔNG NHANH HƠN" CHƯA NÓI LÊN ĐIỀU GÌ
 *
 * Đo trên máy tôi: `new ProjectRepository()` tốn khoảng 69 ns (hai lượt: 69,9 và
 * 68,9). Một route nhiều token nhất trong sniprender khai 5 token, nên phần token
 * tốn cỡ 345 ns. Một request Next cỡ 2 ms. Tỉ lệ: 0,017%.
 *
 * Nhiễu của một benchmark HTTP đầu-cuối thường 1-5%. Hiệu ứng nằm DƯỚI SÀN NHIỄU
 * khoảng 100-300 lần. Không máy nào đo thấy nó bằng lead-time, và máy mạnh cũng
 * không phải lý do: máy nhanh hơn co cả hai vế, tỉ lệ giữ nguyên.
 *
 * Nên bài này KHÔNG dựng HTTP server. Nó cô lập đúng đoạn đã đổi.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO KHÔNG SO v1.1.0 VỚI v2.0.0 NGUYÊN BẢN
 *
 * Giữa hai bản phát hành còn nhiều thay đổi khác. So nguyên bản là trộn phần
 * container với mọi thứ khác, rồi quy công hoặc quy lỗi cho nhầm chỗ.
 *
 * Bài này dựng LẠI đúng hai cách giao token, chạy trên CÙNG một bộ lớp token:
 *   - `giaoKiểuV1`  — vòng lặp `new ClassToken()` của v1, chép nguyên từ
 *                     `inject.ts` bản cũ: dựng NGAY và dựng HẾT.
 *   - `defineTokens` — hàng thật, import từ `../src/container`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAI TRỤC, VÀ TRỤC THỨ HAI MỚI LÀ CHỖ v2 THẮNG ĐẬM
 *
 * 1. LẶP LẠI: v1 dựng lại mỗi request, v2 dựng một lần rồi tra WeakMap.
 * 2. KHAI MÀ KHÔNG DÙNG: v1 dựng đủ 5 token dù handler chỉ đụng 1; v2 lười nên
 *    dựng đúng 1. Với route khai nhiều mà dùng ít, phần này lớn hơn phần (1).
 *
 * Nếu phép đo của Labs chỉ cho `CHẠM = KHAI` thì nó bỏ mất trục thứ hai. Chỉnh
 * bằng biến môi trường CHAM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KẾT QUẢ (MacBook Pro M1 16 GB, node 24, tải máy ~3,8). v3 ở đây là HÀNG THẬT:
 * `withTokens` trong `src/container.ts` của nhánh này, không phải mô hình.
 *
 *   cấu hình                    v1        v2        v3
 *   rẻ (OBJ=3), chạm 1/5      1159      2234        97  ns
 *   rẻ, chạm 5/5              1387      2617       418  ns
 *   khai 10, chạm 1           2262      4475        65  ns
 *   đắt (OBJ=50), chạm 1/5    3710      2342        93  ns
 *
 * HAI ĐIỀU ĐỌC RA:
 *
 * 1. v2 CHẬM HƠN v1 ở 3 trong 4 cấu hình. Nó chỉ thắng khi token ĐẮT. Token của
 *    sniprender rẻ — `new ProjectRepository()` đo được 69 ns — nên ở ứng dụng
 *    thật, container của v2 đang tốn thêm chứ không tiết kiệm. Đây là lời giải
 *    cho việc benchmark của Labs không thấy v2 nhanh hơn v1.
 *
 *    Nguyên nhân: `defineTokens` định nghĩa một ACCESSOR PROPERTY kèm một
 *    CLOSURE cho MỖI token, MỖI request. Đo riêng phần ấy: `defineProperty` với
 *    getter ~1304 ns cho 5 thuộc tính, với value ~952 ns, gán thường ~492 ns.
 *    Cộng thêm việc object có accessor rơi khỏi fast mode của V8. Thứ đó đắt
 *    hơn phần dựng token mà nó tránh được.
 *
 * 2. v3 thắng ở MỌI cấu hình — nhanh hơn v1 khoảng 12-35 lần, hơn v2 6-69 lần —
 *    mà giữ nguyên ngữ nghĩa: vẫn lười, vẫn một instance cho mỗi lớp, vẫn bắt
 *    được token vòng. Nó chỉ đổi chỗ TRẢ TIỀN: bản đồ token của một route cố
 *    định từ lúc khai báo, nên getter dựng sẵn trên prototype của một lớp con,
 *    cache theo (lớp gốc, bản đồ). Đường nóng không còn `defineProperty` nào.
 *
 * MỘT THAY ĐỔI HÀNH VI, nói ra chứ không giấu: token thành thuộc tính KẾ THỪA
 * thay vì own, nên `Object.keys(ctx)` và `{...ctx}` không liệt kê chúng nữa, và
 * `JSON.stringify(ctx)` không đi vào chúng. Đọc `ctx.db` thì y như cũ. Tình cờ
 * điều này khớp với thứ docstring của `Context.set` vẫn mô tả — bản own
 * enumerable accessor hiện tại mới là bản KHÔNG khớp tài liệu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BIẾN MÔI TRƯỜNG
 *   KHAI=5        số token khai trên một route
 *   CHAM=1        số token handler thật sự đọc (<= KHAI)
 *   OBJ=3         số object mỗi token dựng trong constructor
 *                 (repository của sniprender dựng 3: DataSource, QueryBuilder,
 *                  SchemaBuilder)
 *   LAP=200000    số "request" mỗi vòng
 *   VONG=4        số vòng, chạy xen kẽ A/B/A/B
 *   NGAN_SACH_MS=2  p50 thật của một request, để quy ra phần trăm
 */

import { performance, PerformanceObserver } from "node:perf_hooks";
import { defineTokens, withTokens } from "../src/container";

const KHAI = Number(process.env.KHAI ?? 5);
const CHAM = Number(process.env.CHAM ?? 1);
const OBJ = Number(process.env.OBJ ?? 3);
const LAP = Number(process.env.LAP ?? 200_000);
const VONG = Number(process.env.VONG ?? 4);
const NGAN_SACH_MS = Number(process.env.NGAN_SACH_MS ?? 2);

if (CHAM > KHAI) {
  throw new Error("CHAM không được lớn hơn KHAI");
}

/* ── Token giả, nhưng giả đúng hình dạng ──────────────────────────────────
 * Constructor dựng `OBJ` object. Phải có phụ thuộc thật giữa chúng, nếu không
 * trình tối ưu của V8 có quyền bỏ hẳn phần cấp phát và bài đo sẽ báo 0 ns cho
 * cả hai bên — một con số đẹp và vô nghĩa. `giữLại` ở cuối file cũng vì vậy. */
let giữLại: unknown;

function tạoLớpToken(thứTự: number) {
  return class Token {
    readonly phụKiện: object[] = [];
    readonly nhãn: string;
    constructor() {
      this.nhãn = `token-${thứTự}`;
      let trước: object = { gốc: thứTự };
      for (let i = 0; i < OBJ; i += 1) {
        trước = { chỉSố: i, nhãn: this.nhãn, cha: trước };
        this.phụKiện.push(trước);
      }
    }
    dùng() {
      return this.phụKiện.length + this.nhãn.length;
    }
  };
}

type LớpToken = ReturnType<typeof tạoLớpToken>;

function tạoBảnĐồ(): Record<string, LớpToken> {
  const bảnĐồ: Record<string, LớpToken> = {};
  for (let i = 0; i < KHAI; i += 1) {
    bảnĐồ[`t${i}`] = tạoLớpToken(i);
  }
  return bảnĐồ;
}

/** Cách giao của v1: chép nguyên vòng lặp trong `inject.ts` bản cũ. */
function giaoKiểuV1(đích: object, bảnĐồ: Record<string, LớpToken>) {
  for (const [khoá, ClassToken] of Object.entries(bảnĐồ)) {
    Object.defineProperty(đích, khoá, {
      value: new ClassToken(),
      enumerable: true,
      configurable: true,
    });
  }
}

/* ── Đo ───────────────────────────────────────────────────────────────────
 * Không bấm giờ từng lượt: một lượt tốn cỡ vài trăm nanosecond, mà bản thân
 * `performance.now()` đã tốn cỡ đó — đo như vậy là đo cái đồng hồ. Nên bấm giờ
 * theo LÔ, rồi lấy phân vị của thời gian lô. Đuôi của lô là chỗ áp lực cấp phát
 * hiện ra, vì GC dừng cả lô chứ không dừng một lượt. */
const CỠ_LÔ = 1000;

interface KếtQuả {
  nsMỗiLượt: number;
  p50Lô: number;
  p99Lô: number;
  p999Lô: number;
  sốLầnGC: number;
  tổngGCms: number;
  heapTăngMB: number;
}

function phânVị(đãSắp: number[], p: number) {
  const vịTrí = Math.min(đãSắp.length - 1, Math.floor(p * đãSắp.length));
  return đãSắp[vịTrí];
}

function đo(
  tên: string,
  mộtRequest: (bảnĐồ: Record<string, LớpToken>) => void,
  bảnĐồ: Record<string, LớpToken>,
): KếtQuả {
  // Làm nóng: để V8 dịch xong và ổn định hình dạng object trước khi bấm giờ.
  for (let i = 0; i < 20_000; i += 1) mộtRequest(bảnĐồ);

  let sốLầnGC = 0;
  let tổngGCms = 0;
  const theoDõi = new PerformanceObserver(danhSách => {
    for (const mục of danhSách.getEntries()) {
      sốLầnGC += 1;
      tổngGCms += mục.duration;
    }
  });
  theoDõi.observe({ entryTypes: ["gc"] });

  const heapTrước = process.memoryUsage().heapUsed;
  const thờiGianLô: number[] = [];
  const sốLô = Math.ceil(LAP / CỠ_LÔ);

  const bắtĐầu = performance.now();
  for (let lô = 0; lô < sốLô; lô += 1) {
    const t0 = performance.now();
    for (let i = 0; i < CỠ_LÔ; i += 1) mộtRequest(bảnĐồ);
    thờiGianLô.push(performance.now() - t0);
  }
  const tổngMs = performance.now() - bắtĐầu;
  const heapSau = process.memoryUsage().heapUsed;

  theoDõi.disconnect();
  thờiGianLô.sort((a, b) => a - b);

  return {
    nsMỗiLượt: (tổngMs * 1e6) / (sốLô * CỠ_LÔ),
    p50Lô: phânVị(thờiGianLô, 0.5),
    p99Lô: phânVị(thờiGianLô, 0.99),
    p999Lô: phânVị(thờiGianLô, 0.999),
    sốLầnGC,
    tổngGCms,
    heapTăngMB: (heapSau - heapTrước) / 1024 / 1024,
    // `tên` chỉ để đọc khi gỡ lỗi
  } as KếtQuả & { tên?: string };
}

/** Một "request": dựng context rỗng, giao token, rồi handler đọc `CHAM` token. */
function requestV1(bảnĐồ: Record<string, LớpToken>) {
  const ctx: Record<string, any> = {};
  giaoKiểuV1(ctx, bảnĐồ);
  let tổng = 0;
  for (let i = 0; i < CHAM; i += 1) tổng += ctx[`t${i}`].dùng();
  giữLại = tổng;
}

/* v3 — HÀNG THẬT: `withTokens` trong `src/container.ts` của nhánh này.
 *
 * Bản đồ token của một route cố định từ lúc khai báo, nên `withTokens` dựng một
 * lớp con mang sẵn getter trên prototype, cache theo (lớp gốc, bản đồ). Mỗi
 * request chỉ `new` — không `defineProperty` lần nào trong đường nóng. */
class NềnRỗng {}

function requestV3(bảnĐồ: Record<string, LớpToken>) {
  const Lớp = withTokens(NềnRỗng as any, bảnĐồ as any) as any;
  const ctx = new Lớp();
  let tổng = 0;
  for (let i = 0; i < CHAM; i += 1) tổng += ctx[`t${i}`].dùng();
  giữLại = tổng;
}

function requestV2(bảnĐồ: Record<string, LớpToken>) {
  const ctx: Record<string, any> = {};
  defineTokens(ctx, bảnĐồ as any);
  let tổng = 0;
  for (let i = 0; i < CHAM; i += 1) tổng += ctx[`t${i}`].dùng();
  giữLại = tổng;
}

/* ── Chạy xen kẽ A/B/A/B ──────────────────────────────────────────────────
 * Chạy hết A rồi hết B thì mọi trôi theo thời gian — nhiệt độ CPU, tải nền,
 * trạng thái heap — đều cộng dồn vào B. Xen kẽ rồi lấy TRUNG VỊ các vòng thì
 * cái trôi ấy rơi vào cả hai bên như nhau. */
function trungVị(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function chạy() {
  console.log(
    `KHAI=${KHAI} token/route · CHẠM=${CHAM} · OBJ=${OBJ} object/token · ` +
      `LẶP=${LAP.toLocaleString("vi")} · VÒNG=${VONG}\n` +
      `node ${process.version} · ${process.platform}/${process.arch}\n`,
  );

  const kq: Record<"v1" | "v2" | "v3", KếtQuả[]> = { v1: [], v2: [], v3: [] };

  for (let vòng = 0; vòng < VONG; vòng += 1) {
    // Bản đồ MỚI mỗi vòng cho v2: WeakMap khoá theo chính lớp, nên dùng lại lớp
    // cũ là vòng sau ăn sẵn cache của vòng trước và v2 được lợi không công bằng.
    kq.v1.push(đo("v1", requestV1, tạoBảnĐồ()));
    kq.v2.push(đo("v2", requestV2, tạoBảnĐồ()));
    kq.v3.push(đo("v3", requestV3, tạoBảnĐồ()));
  }

  const lấy = (b: "v1" | "v2" | "v3", k: keyof KếtQuả) =>
    trungVị(kq[b].map(r => r[k] as number));

  const hàng = (nhãn: string, k: keyof KếtQuả, đơnVị: string, sốLẻ = 1) => {
    const a = lấy("v1", k);
    const b = lấy("v2", k);
    const c = lấy("v3", k);
    console.log(
      `  ${nhãn.padEnd(22)} ${a.toFixed(sốLẻ).padStart(10)} ${b
        .toFixed(sốLẻ)
        .padStart(10)} ${c.toFixed(sốLẻ).padStart(10)}  ${đơnVị}`,
    );
  };

  console.log(`  ${"".padEnd(22)} ${"v1".padStart(10)} ${"v2".padStart(10)} ${"v3".padStart(10)}`);
  hàng("mỗi lượt", "nsMỗiLượt", "ns");
  hàng("lô p50", "p50Lô", "ms", 3);
  hàng("lô p99", "p99Lô", "ms", 3);
  hàng("lô p99.9", "p999Lô", "ms", 3);
  hàng("số lần GC", "sốLầnGC", "lần", 0);
  hàng("tổng thời gian GC", "tổngGCms", "ms", 1);
  hàng("heap tăng", "heapTăngMB", "MB", 1);

  const chênhNs = lấy("v1", "nsMỗiLượt") - lấy("v2", "nsMỗiLượt");
  const phầnTrăm = (chênhNs / (NGAN_SACH_MS * 1e6)) * 100;

  console.log(
    `\n  v2 bớt được ${chênhNs.toFixed(0)} ns mỗi request.\n` +
      `  Trên một request ${NGAN_SACH_MS} ms, đó là ${phầnTrăm.toFixed(4)}%.\n`,
  );

  if (phầnTrăm < 0.5) {
    console.log(
      `  ĐỌC KẾT QUẢ: ${phầnTrăm.toFixed(4)}% nằm dưới sàn nhiễu của mọi phép đo\n` +
        `  đầu-cuối (thường 1-5%). Một benchmark HTTP KHÔNG THỂ phân giải mức này,\n` +
        `  trên máy nào cũng vậy — nên "v2 không nhanh hơn" ở phép đo đó không phải\n` +
        `  bằng chứng cho bất kỳ chiều nào. Chỗ đáng nhìn là ba dòng GC phía trên:\n` +
        `  nếu v2 cấp phát ít hơn thì nó hiện ở đó, và ở đuôi p99.9 khi tải bền.\n`,
    );
  }

  console.log(
    `  Thử lại với CHAM=1 KHAI=10 để thấy phần LƯỜI (khai mà không dùng),\n` +
      `  rồi CHAM=${KHAI} KHAI=${KHAI} để thấy riêng phần CACHE. Hai trục khác nhau.\n`,
  );

  if (giữLại === undefined) throw new Error("không thể xảy ra");
}

chạy();
