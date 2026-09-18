/* 0025: "gói KHÔNG BAO GIỜ phụ thuộc @ecosy/core — ở bất kỳ tầng nào." This
   file is not about CSRF — it is about the package as a whole, and it lives
   here because `csrf.ts` is the first module that ever had a reason to
   reach for `@ecosy/core` (the real CSRF/session implementation lives
   there). The three checks below are the three layers a stray import could
   hide in: the declared dependency graph (package.json), the compiled
   output every consumer actually loads (dist/), and the source a future
   contributor might patch without rebuilding first (src/). Any one of them
   passing while the others fail would still ship the dependency this task
   exists to keep out. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file under `dir`, recursively — same shape as `tests/hooks.mjs`'s
 *  own directory walk, so a subdirectory (dist/ has none today, but src/
 *  has `utils/`) is never silently skipped. */
function allFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

test("package.json never lists @ecosy/core in dependencies or peerDependencies", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.ok(
    !("@ecosy/core" in (pkg.dependencies ?? {})),
    "@ecosy/core must not appear in dependencies — this package ships only the CSRF/session PORTS, not the implementation",
  );
  assert.ok(
    !("@ecosy/core" in (pkg.peerDependencies ?? {})),
    "@ecosy/core must not appear in peerDependencies either — a peer dep would still force every consumer to have it installed",
  );
});

/* The task's own wording for these two checks is a blunt "the string
   `@ecosy/core` does not appear anywhere" — but that literal reading is
   unsatisfiable together with two OTHER explicit orders in this same task:
   `src/cookie-jar.ts`'s own docblock already says `@ecosy/core/session` and
   `@ecosy/core/csrf` in prose, documenting exactly why this package imports
   neither (this file no longer claims cookie-jar.ts is byte-identical with
   release/1.1.0 — 0030's `0cd185a` deliberately added JSDoc to it, on
   purpose and said so in that commit; only the reason for THIS check, the
   prose mention, still holds); and `csrf.ts`'s `CsrfPort` docblock —
   copied verbatim from release/1.1.0, "KHÔNG đổi một ký tự nào" — carries
   the same kind of mention for the same reason. Both predate this task and
   neither is an import.

   The task's own stated PURPOSE for this check is narrower than its literal
   wording: "đây là cái bắt được một import lọt vào bất kỳ module nào" — catch
   an import that leaked in, not a doc comment that names the package it
   deliberately does not depend on. So this checks for the package name in
   import/require POSITION — `from "@ecosy/core...`, `require("@ecosy/core...`,
   `import("@ecosy/core...` — in either quote style, which is the only shape
   an actual dependency can take in emitted JS/TS. A prose mention in a
   comment or docblock, with no `from`/`require(`/`import(` immediately
   before the quoted string, does not match and is not what this test is
   for. */
const CORE_IMPORT = /\b(?:from\s+|require\(\s*|import\(\s*)["']@ecosy\/core(?:\/[^"']*)?["']/;

test("no file under dist/ imports or requires \"@ecosy/core\" — this is the layer every consumer actually loads, and it catches an import that landed in ANY module, not just csrf.ts", () => {
  const distDir = join(repoRoot, "dist");
  const offenders = [];
  for (const file of allFiles(distDir)) {
    const content = readFileSync(file, "utf8");
    if (CORE_IMPORT.test(content)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `an import/require of @ecosy/core found in compiled output: ${offenders.join(", ")}`);
});

test("no .ts file under src/ imports \"@ecosy/core\" — the source-level check, so a stray import is caught even before a rebuild would surface it in dist/", () => {
  const srcDir = join(repoRoot, "src");
  const offenders = [];
  for (const file of allFiles(srcDir)) {
    if (!file.endsWith(".ts")) continue;
    const content = readFileSync(file, "utf8");
    if (CORE_IMPORT.test(content)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `an import of @ecosy/core found in source: ${offenders.join(", ")}`);
});
