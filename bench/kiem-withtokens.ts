import { withTokens, resolve } from "../src/container";

let sốLầnDựng = 0;
class Db { constructor() { sốLầnDựng += 1; } tên() { return "db"; } }
class Log { tên() { return "log"; } }

class Base {
  constructor(public đánhDấu: string) {}
  phươngThứcCủaBase() { return "base"; }
}

const bảnĐồ = { db: Db, log: Log };
const Sub = withTokens(Base as any, bảnĐồ as any) as any;

const a = new Sub("a");
const b = new Sub("b");

const kiểm: [string, boolean][] = [
  ["getter trả đúng instance", a.db instanceof Db],
  ["vẫn là instance của Base", a instanceof Base],
  ["phương thức của Base còn nguyên", a.phươngThứcCủaBase() === "base"],
  ["constructor của Base vẫn chạy", a.đánhDấu === "a" && b.đánhDấu === "b"],
  ["token KHÔNG phải own property", !Object.prototype.hasOwnProperty.call(a, "db")],
  ["token nằm trên prototype", Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(a), "db")],
  ["hai instance dùng CHUNG một token", a.db === b.db],
  ["chỉ dựng đúng một lần", sốLầnDựng === 1],
  ["token chưa đụng thì chưa dựng", (() => { let n = 0; class Lười { constructor() { n += 1; } }
      const S2: any = withTokens(Base as any, { lười: Lười } as any); const x = new S2("x");
      const chưaDựng = n === 0; void x.lười; return chưaDựng && n === 1; })()],
  ["cùng bản đồ → cùng lớp con", withTokens(Base as any, bảnĐồ as any) === Sub],
  ["bản đồ khác → lớp con khác", withTokens(Base as any, { db: Db } as any) !== Sub],
  ["resolve trực tiếp ra cùng instance", resolve(Db as any) === a.db],
  ["Object.keys KHÔNG liệt kê token (đã ghi rõ)", !Object.keys(a).includes("db")],
];

let hỏng = 0;
for (const [tên, ok] of kiểm) {
  console.log(`  ${ok ? "✓" : "✗"} ${tên}`);
  if (!ok) hỏng += 1;
}
console.log(hỏng ? `\n  ${hỏng} mục HỎNG` : `\n  ${kiểm.length}/${kiểm.length} đạt`);
process.exit(hỏng ? 1 : 0);
