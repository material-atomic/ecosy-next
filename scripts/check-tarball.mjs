#!/usr/bin/env node
/*
 * A positive check on what actually ends up inside the published tarball.
 *
 * Ported from packages/ecosy-anchor/scripts/check-tarball.mjs (task 0062),
 * which exists because `npm pack --dry-run` on a tree where `dist/` has not
 * been built yet exits 0, prints no warning, and produces a tarball that
 * looks fine on the screen. A CI step that only checks the exit code of
 * `npm publish` cannot tell a full release from an empty one — both are
 * green.
 *
 * `@ecosy/next` is NOT the same shape as `anchor`, and this file does not
 * assume it is (task 0062's debt entry says this package must be re-measured
 * from scratch, not cloned blind):
 *
 *   - `files: ["dist", "CHANGELOG.md"]` — no "README.md" entry, unlike
 *     anchor's `files: ["dist", "README.md"]`. Measured 2026-09-19 on a
 *     `git archive HEAD` copy with NO dist/: `npm pack --dry-run --json`
 *     still produces README.md in the tarball anyway (npm auto-includes a
 *     README* file that npm find on disk regardless of `files:` — the same
 *     "npm tự thêm README/LICENSE, KHÔNG thêm CHANGELOG" behavior the house
 *     rules log already measured for a different package). So the pre-build
 *     tarball here is 3 files (CHANGELOG.md, README.md, package.json), not
 *     anchor's 2 — still exactly the same "hỏng im" shape: exit 0, no dist/,
 *     no warning.
 *   - Three entry points, not one: `exports` declares ".", "./inject" and
 *     "./jwt", each with its own `dist/<name>.{js,mjs,d.ts}` trio. A guard
 *     copied from anchor that only knows about `dist/index.*` would miss a
 *     broken `./inject` or `./jwt` build silently.
 *   - `dist/` here is far bigger (source tree has ~20 modules, one per
 *     `src/*.ts` file, each emitting 6 files with sourcemaps) — 141 files in
 *     a real build vs. anchor's 8. The floor below is picked to sit between
 *     the measured 3-file "not built" case and the measured 141-file real
 *     case, not copied from anchor's floor of 5.
 *
 * Run this AFTER the build step and BEFORE `npm publish`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const errors = [];

function fail(message) {
  errors.push(message);
}

// `npm pack --dry-run --json` runs the same packing code path `npm publish`
// uses, without writing a tarball or touching the registry.
//
// Measured 2026-09-19 (same method as anchor's corrected comment): a
// `"prepack"` script, if this package ever grows one, WOULD run here and its
// stdout would land ahead of the JSON this script parses below. `@ecosy/next`
// today has neither `prepack` nor `prepare` — only `prepublishOnly`, which
// `npm pack` does not run — so stdout here is pure JSON. A future package
// this script gets cloned onto that DOES have `prepack`/`prepare` needs this
// re-checked, not assumed.
let packOutput;
try {
  packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
  });
} catch (err) {
  console.error("check-tarball: `npm pack --dry-run --json` itself failed:");
  console.error(err.stdout || err.message);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(packOutput);
} catch (err) {
  console.error("check-tarball: could not parse `npm pack --dry-run --json` output as JSON.");
  console.error(packOutput);
  process.exit(1);
}

const entry = manifest[0];
if (!entry) {
  console.error("check-tarball: `npm pack --dry-run --json` returned no package entry.");
  process.exit(1);
}

const files = entry.files.map((f) => f.path);
const fileSet = new Set(files);

// --- Positive assertions: literal, hand-written names. Not read from
// `files:` in package.json or from a directory listing of `dist/` — the
// point of this script is to be an independent witness. Measured on a real
// build, 2026-09-19: all eleven of these are present, alongside 130 other
// dist/ files (per-module .js/.mjs/.d.ts/.map) this list does not enumerate
// one by one — the entry-point walk below covers those via package.json
// instead of a giant hand-typed list. ---
const mustHave = [
  "dist/index.js",
  "dist/index.mjs",
  "dist/index.d.ts",
  "dist/inject.js",
  "dist/inject.mjs",
  "dist/inject.d.ts",
  "dist/jwt.js",
  "dist/jwt.mjs",
  "dist/jwt.d.ts",
  "package.json",
  "CHANGELOG.md",
  // Not declared in `files:`, but measured to ship anyway (npm auto-adds a
  // README* it finds on disk regardless of `files:` — see the file-level
  // comment above). Asserting it here catches the day someone renames or
  // deletes README.md and npm quietly stops attaching one.
  "README.md",
];

for (const wanted of mustHave) {
  if (!fileSet.has(wanted)) {
    fail(`missing "${wanted}" from the tarball`);
  }
}

// The package's own `main`/`module`/`types`/`exports` entry points must
// really be inside the tarball a consumer downloads, not just declared.
// Read package.json fresh (not cached from anywhere else in this script) so
// this catches a mismatch between what package.json promises and what
// dist/ actually produced.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const entryPointCandidates = new Set();
if (typeof pkg.main === "string") entryPointCandidates.add(pkg.main);
if (typeof pkg.module === "string") entryPointCandidates.add(pkg.module);
if (typeof pkg.types === "string") entryPointCandidates.add(pkg.types);
if (pkg.exports && typeof pkg.exports === "object") {
  // The "source" condition points straight at `src/` on purpose — it exists
  // for bundlers/tools that resolve TypeScript directly in a local
  // workspace (every one of "." / "./inject" / "./jwt" here declares one),
  // and it is never meant to survive into the published tarball (a tarball
  // that DID ship it would fail the "no src/" negative assertion below).
  // Walking into it here would make this script demand its own failure
  // mode — this is the exact bug task 0062's Kết quả records fixing on
  // `anchor`, ported forward rather than reintroduced.
  const walk = (node, key) => {
    if (key === "source") return;
    if (typeof node === "string") {
      entryPointCandidates.add(node);
    } else if (node && typeof node === "object") {
      for (const [childKey, value] of Object.entries(node)) walk(value, childKey);
    }
  };
  walk(pkg.exports, undefined);
}

for (const raw of entryPointCandidates) {
  if (raw === "./package.json" || raw === "package.json") continue; // always present, not a build artifact
  const normalized = raw.replace(/^\.\//, "");
  if (!fileSet.has(normalized)) {
    fail(`package.json declares entry point "${raw}" but the tarball does not contain "${normalized}"`);
  }
}

// --- Negative assertions: source, test, and dev-only trees must never
// ship. "bench/" is this package's own addition over anchor's list — it is
// a real top-level tracked directory here (git ls-files: bench/README.md,
// bench/*), and `files:` already excludes it today, but this is
// defense-in-depth against someone widening `files:` later without
// re-reading this script. ---
const forbiddenPrefixes = ["src/", "tests/", "types-test/", "bench/"];
for (const filePath of files) {
  for (const prefix of forbiddenPrefixes) {
    if (filePath.startsWith(prefix)) {
      fail(`tarball contains "${filePath}", which is under the forbidden prefix "${prefix}"`);
    }
  }
}

// --- Count assertion. Measured 2026-09-19 on a `git archive HEAD` copy
// (no dist/, no node_modules): `npm pack --dry-run` produces exactly 3
// files (CHANGELOG.md, README.md, package.json) — this package's version of
// the "one tarball, N files" trap the task is named after, exit 0, no
// warning. A real build produces 141. The floor below is a literal, picked
// to sit strictly between those two measured numbers (not derived from
// either), so it goes RED on the exact tree that produced the 3-file
// tarball and GREEN on the exact tree that produced the 141-file one. ---
const FLOOR = 100;
if (entry.entryCount < FLOOR) {
  fail(
    `tarball has only ${entry.entryCount} file(s), below the floor of ${FLOOR} — this is the "one tarball, N files" failure the task is named after`,
  );
}

// --- .map report (not a gate): report whether sourcemaps ship full source,
// do not decide whether that is allowed — same policy as anchor's script.
const mapFiles = files.filter((f) => f.endsWith(".map"));
console.log(`check-tarball: ${mapFiles.length} .map file(s) in the tarball.`);
let sourcesContentCount = 0;
for (const mapPath of mapFiles) {
  const onDisk = path.join(process.cwd(), mapPath);
  if (!existsSync(onDisk)) continue;
  try {
    const map = JSON.parse(readFileSync(onDisk, "utf8"));
    const hasSourcesContent = Array.isArray(map.sourcesContent) && map.sourcesContent.some((s) => typeof s === "string" && s.length > 0);
    if (hasSourcesContent) sourcesContentCount += 1;
  } catch {
    // unreadable/unparseable .map — not this script's job to fail on that
  }
}
console.log(`check-tarball:   of those, ${sourcesContentCount} carry full source text in sourcesContent (tsconfig.json "sourceMap": true, rollup.config.mjs sourcemap: true, both measured 2026-09-19).`);

// --- Verdict ---
console.log(`check-tarball: ${files.length} file(s) in tarball (showing count only — see mustHave/forbiddenPrefixes above for names checked).`);

if (errors.length > 0) {
  console.error("check-tarball: FAILED");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("check-tarball: OK — all positive, negative, and count assertions passed.");
