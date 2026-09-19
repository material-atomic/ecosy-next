#!/usr/bin/env node
/* Permanent measurement tool for how a Context delivers its injected
   tokens — the thing task 0064 changed (own accessor -> own data property,
   defined eagerly instead of lazily). House rule: "Dụng cụ đo dựng cho một
   task thì chết theo task đó. Thứ ta đo lại nhiều lần ... phải để ở chỗ
   chạy lại được từ cây sạch." Three benchmarks were built and thrown away
   for this exact question (0037, 0056, 0059) before this task decided to
   keep exactly one.

   Run from a clean tree, after `npm run build`:
       node bench/token-delivery.mjs

   Reads the BUILT package (`dist/`), the same way every test in tests/
   does — no `tsx`, no extra dependency. `--import ../tests/hooks.mjs` is
   loaded programmatically below (not on the CLI) so this file needs no
   special invocation.

   NOT part of `npm test` / `npm run test:run` — it is a tool, not a gate.
   A pass/fail assertion belongs in tests/, not here. */

import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";

/* tests/hooks.mjs calls `registerHooks(...)` (a node:module API) as soon as
   it is evaluated — that is a side effect of importing it, not something
   this file has to call itself. A static import runs before any of this
   file's own top-level code, including the `require(distIndex)` call
   below, so it has the same effect `node --import ./tests/hooks.mjs` has
   on the command line: `server-only` and `next/headers` are swapped for
   stand-ins before dist/cookie.js (reached transitively through the root
   entry) ever tries to load them for real. Same file `tests/*.test.mjs`
   all rely on; this is not a second copy of that logic. It also throws if
   dist/ is older than src/, which is exactly the property this bench wants
   too — measuring a stale build would be worse than not measuring at all. */
import "../tests/hooks.mjs";

const require = createRequire(import.meta.url);
const distIndex = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const { Route } = require(distIndex);
const { NextRequest } = require("next/server");

const LOTS = 1000;
const WARM = 20000;
const ROUNDS = 5;

function counted(name) {
  const Token = class {
    constructor() {
      Token.count++;
    }
  };
  Object.defineProperty(Token, "name", { value: name });
  Token.count = 0;
  return Token;
}

function tokenMap(n) {
  const map = {};
  for (let i = 0; i < n; i++) map[`t${i}`] = counted(`T${i}`);
  return map;
}

const payload = () => ({ params: Promise.resolve({}) });
const url = "http://localhost/api/x";

/** Builds a Route with `khai` tokens, whose handler reads `cham` of them,
 *  and returns a function that runs one request through it. */
function makeRunner(khai, cham) {
  const injects = tokenMap(khai);
  const keys = Object.keys(injects);
  const { GET } = Route(injects).get((ctx) => {
    let sum = 0;
    for (let i = 0; i < cham; i++) sum += ctx[keys[i]] ? 1 : 0;
    return sum;
  });
  return async () => {
    await GET(new NextRequest(url), payload());
  };
}

async function timeOne(run, lots) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < lots; i++) await run();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / lots;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  console.log("node", process.version, process.platform, process.arch);
  console.log("loadavg", os.loadavg());
  console.log(`LOTS=${LOTS} WARM=${WARM} ROUNDS=${ROUNDS}\n`);

  const configs = [];
  for (const khai of [5, 10]) {
    for (const cham of [0, 1, 5]) {
      if (cham > khai) continue;
      configs.push({ khai, cham });
    }
  }

  console.log("ns/request per configuration:");
  for (const { khai, cham } of configs) {
    const run = makeRunner(khai, cham);
    await timeOne(run, WARM);
    const samples = [];
    for (let r = 0; r < ROUNDS; r++) samples.push(await timeOne(run, LOTS));
    console.log(
      `  KHAI=${khai} CHAM=${cham}: median ${median(samples).toFixed(1)} ns  (rounds: ${samples.map((n) => n.toFixed(1)).join(", ")})`
    );
  }

  /* Negative control: two independently-built runners for the identical
     KHAI=5/CHAM=1 shape. Without this, every number above is unreadable —
     there is nothing to compare its distance to. House rule: an A/A
     control must be built from the thing CURRENTLY being measured, twice,
     not compared against an old baseline. */
  console.log("\nA/A negative control (KHAI=5, CHAM=1, run twice independently):");
  const runA = makeRunner(5, 1);
  const runB = makeRunner(5, 1);
  await timeOne(runA, WARM);
  await timeOne(runB, WARM);
  const deltas = [];
  for (let r = 0; r < ROUNDS; r++) {
    const a = await timeOne(runA, LOTS);
    const b = await timeOne(runB, LOTS);
    deltas.push(a - b);
  }
  const absDeltas = deltas.map(Math.abs);
  console.log(`  |delta| per round: ${absDeltas.map((n) => n.toFixed(1)).join(", ")} ns`);
  console.log(`  sign per round:    ${deltas.map((d) => (d >= 0 ? "+" : "-")).join("")}`);
  console.log(
    `  Any conclusion drawn from the table above should sit well clear of ${Math.max(...absDeltas).toFixed(1)} ns (the worst round here) — see task 0064 §3.1 for how this repo has used that floor.`
  );
}

main();
