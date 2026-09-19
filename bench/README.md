# Nhánh `labs/v3-token-prototype`

Gửi phòng Labs đọc. Nhánh này **chưa merge** và chưa publish.

## Chạy thử

```sh
npm install
npx tsx bench/kiem-withtokens.ts        # 13 phép kiểm hành vi
npx tsx bench/token-delivery.bench.ts   # đo v1 / v2 / v3
```

Đổi hình dạng bằng biến môi trường — `KHAI` (số token khai trên route),
`CHAM` (số token handler thật sự đọc), `OBJ` (số object mỗi token dựng).
Mặc định `KHAI=5 CHAM=1 OBJ=3` là hình dạng của sniprender.

## Vì sao có nhánh này

Benchmark của Labs không thấy v2 nhanh hơn v1. Đo kỹ thì lý do không phải
máy mạnh, mà là **v2 đang chậm hơn v1 ở 3 trong 4 cấu hình**.

`defineTokens` định nghĩa một accessor property kèm một closure cho mỗi
token, mỗi request. Với token rẻ — `new ProjectRepository()` đo được 69 ns —
phần định nghĩa ấy đắt hơn phần dựng token mà nó tránh được.

Bản đồ token của một route thì cố định từ lúc khai báo. `withTokens` dựng
một lớp con mang sẵn getter trên prototype, cache theo (lớp gốc, bản đồ),
nên mỗi request chỉ còn `new`. Ngữ nghĩa giữ nguyên: vẫn lười, vẫn một
instance cho mỗi lớp, vẫn bắt được token vòng.

## Thay đổi hành vi, một chỗ

Token thành thuộc tính **kế thừa** thay vì own. `Object.keys(ctx)`,
`{...ctx}` và `JSON.stringify(ctx)` không thấy chúng nữa; `ctx.db` thì y hệt.

Đây là chỗ cần Labs quyết, không phải chỗ tôi tự quyết. Tôi đã grep repo và
không thấy chỗ nào liệt kê thuộc tính của context, nhưng mã ứng dụng ngoài
repo thì tôi không thấy được.

## Chỗ cần soi lại giúp

Hàm `giaoKiểuV1` trong benchmark là bản chép lại vòng lặp của v1 từ
`inject.ts` cũ. Nếu nó chép sai thì kết luận "v2 chậm hơn v1" sai theo.
