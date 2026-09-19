# bench/

A tool, not a gate. Nothing here runs as part of `npm test` or
`npm run test:run`, and nothing here is allowed to fail a CI job — it
prints numbers for a person to read, on the machine it happens to run on.

## Running the benchmark

```bash
npm run build
node bench/token-delivery.mjs
```

It measures how a `Context` delivers its injected tokens (`defineTokens` in
`src/container.ts`) across a few shapes — different numbers of declared
tokens, different numbers actually read by the handler — and prints
`ns/request`, plus an A/A negative control so the numbers have something to
be compared against. Read `node loadavg` in its own output before trusting
any number: a busy machine inflates every column by roughly the same
amount, and the negative control is what tells "everything is slower today"
apart from "something actually regressed."

This is the third benchmark for this exact question in this repo's history
(0037, 0056, 0059 each built one and let it go). Nợ N10 of task 0059: the
bench built there had a `README.md` that only ever told a reader to run the
bench — never the one thing that actually caught the regression that
prompted writing it in the first place, which was the real test suite. This
file exists so that mistake does not repeat a fourth time.

## Running the tests

The benchmark tells you if something got SLOWER. It tells you nothing about
whether something got WRONG — `defineTokens` returning the wrong instance,
silently, is invisible to a stopwatch. That is what the test suite is for:

```bash
npm run test:run
```

(`npm test` does the same thing plus a rebuild first — see `package.json`.)
`tests/container.test.mjs`, `tests/token-lifetime.test.mjs` and
`tests/proxy-activation.test.mjs` are the ones that touch this exact code
path most directly, but the whole suite runs in under two seconds, so there
is no reason to run a subset.

## Why this file exists at all, and why nothing else does

House rule: "Dụng cụ đo dựng cho một task thì chết theo task đó. Thứ ta đo
lại nhiều lần — bench, bộ canh, harness đột biến — phải để ở chỗ chạy lại
được từ cây sạch." Everything else built while measuring task 0064
(A/A harness scripts under a scratch directory, mutation-testing drivers,
one-off probes for whether `new Function` is blocked somewhere) was built
to answer a question that is now answered, and none of it belongs in this
repo. `bench/token-delivery.mjs` is the one thing in that pile that answers
a question worth re-asking after every future change to how tokens reach a
context — so it is the one thing kept.
