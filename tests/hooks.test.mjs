/* Net under `tests/hooks.mjs` itself — the mtime guard that every other
   test file in this repo runs behind (`--import ./tests/hooks.mjs`). 0039
   round 2 added the guard; round 3 added this file after QA found it had
   NO net of its own; round 4 rewrote it around an "exclude a future mtime,
   warn once" design. Round 5 rewrites it again: QA measured that round 4's
   design was a SILENT FALSE NEGATIVE on the real repo — a broken src/
   file whose mtime also happened to be in the future passed 100/100 green,
   because the guard's own fix excluded the one file that mattered. The
   guard is fail-closed again (a future mtime throws), so the fixtures
   below are not the same as round 4's — in particular the round 4
   "future mtime does not block the guard" test now asserts the OPPOSITE:
   a future mtime DOES throw, immediately, naming the file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newestMtime } from "./hooks.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksPath = join(repoRoot, "tests", "hooks.mjs");

/** Writes `files` (an array of [path, mtimeMs]) under `root`, creating parent
 *  directories as needed, with mtimes set explicitly rather than left to
 *  whatever the filesystem gives a freshly-written file. */
function writeFixtureFiles(files) {
  for (const [path, mtimeMs] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "// fixture file for tests/hooks.test.mjs\n");
    const d = new Date(mtimeMs);
    utimesSync(path, d, d);
  }
}

function spawnHooksAgainst(srcDir, distDir) {
  return spawnSync(process.execPath, ["--import", hooksPath, "-e", ""], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ECOSY_HOOKS_SRC_DIR: srcDir, ECOSY_HOOKS_DIST_DIR: distDir },
  });
}

/** Builds a disposable {src, dist} root under the OS temp dir and returns its
 *  three paths; caller removes it with `rmSync(root, { recursive: true, force: true })`. */
function fixtureRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, src: join(root, "src"), dist: join(root, "dist") };
}

/* ------------------------------------------------------------------------ */
/* 1. Ordinary staleness: a genuinely newer, NESTED src/ file (not future)  */
/*    still makes the guard throw. Unaffected by the future-mtime redesign  */
/*    — isolated from it so it tests exactly one thing: recursion into      */
/*    src/utils/ feeds the comparison at all.                               */
/* ------------------------------------------------------------------------ */

test("node --import ./tests/hooks.mjs refuses to start when a NESTED src/ file is genuinely newer than dist/ — recursion into src/utils/ is not a no-op", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-stale-nested-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "top.ts"), now - 100_000],
    [join(src, "utils", "nested.ts"), now - 10_000], // newer than dist, but not future
    [join(dist, "out.js"), now - 50_000],
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `expected a non-zero exit; got ${result.status}. stderr: ${result.stderr}`);
});

test("the same guard passes (exit 0) on a fixture where dist/ is genuinely newer than every src/ file, nested or not", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-fresh-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "top.ts"), now - 100_000],
    [join(src, "utils", "nested.ts"), now - 90_000],
    [join(dist, "out.js"), now - 10_000],
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.equal(result.status, 0, `expected exit 0 with a genuinely fresh dist/; got ${result.status}. stderr: ${result.stderr}`);
});

/* ------------------------------------------------------------------------ */
/* 2. The actual bug QA measured on the real repo, round 5: a future mtime  */
/*    on a src/ file must FAIL CLOSED — throw immediately, naming the      */
/*    exact file, with a remedy that can actually be followed (touch the   */
/*    file, or fix the clock). This is the opposite of round 4's own test  */
/*    with the same name — round 4 excluded the future file and passed;    */
/*    that exclusion is exactly what let a real, broken src/context.ts     */
/*    pass 100/100 on the real repo once its mtime also drifted forward.   */
/* ------------------------------------------------------------------------ */

test("a src/ file with a mtime in the future makes the guard throw immediately, naming the exact file and a remedy that can be followed (touch it, or fix the clock) — not `run yarn build`, which cannot move a clock-skewed timestamp back into the past", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-future-fails-closed-");
  const now = Date.now();
  const futurePath = join(src, "utils", "future.ts");
  writeFixtureFiles([
    [join(src, "top.ts"), now - 100_000],
    [futurePath, now + 600_000], // 10 minutes ahead — clock skew, not a real edit
    [join(dist, "out.js"), now - 10_000],
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `a future mtime must fail closed, not pass; got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes(futurePath), "the error must name the exact file, not just say something is in the future");
  assert.match(result.stderr, /touch/, "the error must give a remedy that actually resolves clock skew (touch the file)");
  assert.match(result.stderr, /clock/, "the error must mention the other real remedy (fixing the system clock)");
});

/* ------------------------------------------------------------------------ */
/* 3. QA's exact real-repo measurement: distinguish "found no files         */
/*    anywhere under this root" from "found files, all of them future-      */
/*    dated". Before this round, the latter collapsed into the former's     */
/*    message on the real repo — `has no files anywhere under it` printed  */
/*    while src/ actually held 19 files, because every one of them had     */
/*    been excluded rather than counted. Fail-closed removes the collapse  */
/*    structurally: the FIRST future file found throws its own specific    */
/*    error before the walk ever reaches a point where "no files" could be */
/*    confused with "all excluded".                                        */
/* ------------------------------------------------------------------------ */

test("src/ where EVERY file is future-dated (not just one) throws the future-mtime error naming a real file — not the empty-directory message, even though src/ is not empty", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-all-future-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "a.ts"), now + 60_000],
    [join(src, "b.ts"), now + 120_000],
    [join(src, "utils", "c.ts"), now + 180_000],
    [join(dist, "out.js"), now - 10_000],
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `all-future src/ must still fail; got ${result.status}. stderr: ${result.stderr}`);
  assert.doesNotMatch(
    result.stderr,
    /has no files anywhere under it/,
    "src/ genuinely has three files — the error must not claim it found none, just because all three were future-dated",
  );
  assert.match(result.stderr, /has a mtime in the future/, "the error must be the specific future-mtime one, naming a real file");
});

/* ------------------------------------------------------------------------ */
/* 4. Symmetry (round 4's architecture had a separate exclusion applied     */
/*    per call, which QA could in principle have found disabled for dist/  */
/*    specifically while src/ stayed protected — "S5" in the round-5        */
/*    brief). Round 5's newestMtime() is ONE code path used identically    */
/*    for both trees, so there is no per-directory branch left to disable; */
/*    this test is the closest observable equivalent: a future file under  */
/*    dist/ must fail exactly like one under src/, not pass silently.      */
/* ------------------------------------------------------------------------ */

test("a future-dated file under dist/ also fails closed — the guard is not special-cased to only distrust src/'s timestamps", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-dist-future-");
  const now = Date.now();
  const futureDistPath = join(dist, "out.js");
  writeFixtureFiles([
    [join(src, "top.ts"), now - 100_000],
    [futureDistPath, now + 600_000],
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `a future dist/ file must fail closed too; got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes(futureDistPath), "the error must name the dist/ file specifically");
});

/* ------------------------------------------------------------------------ */
/* 5. `<` vs `<=` at the top-level comparison: dist/ exactly as new as     */
/*    src/'s newest file must count as fresh enough, not stale. tsc and    */
/*    rollup can legitimately stamp several output files with the same     */
/*    wall-clock millisecond as a source file on a fast build, so          */
/*    "equally fresh" has to mean "fresh", not "stale".                    */
/* ------------------------------------------------------------------------ */

test("dist/ exactly as new as src/'s newest file counts as fresh — the comparison is strict `<`, not `<=`", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-tie-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "top.ts"), now - 100_000],
    [join(dist, "out.js"), now - 100_000], // exactly tied with src's newest file
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.equal(result.status, 0, `a tie must count as fresh, not stale; got ${result.status}. stderr: ${result.stderr}`);
});

/* ------------------------------------------------------------------------ */
/* 6. Round 4 mục 3, unaffected by the fail-closed redesign: pointing       */
/*    either ECOSY_HOOKS_*_DIR at a directory that exists but holds no      */
/*    files at all must be an error, not a silent pass.                     */
/* ------------------------------------------------------------------------ */

test("an empty src/ directory is an error, not a silent pass — even when dist/ has real files", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-empty-src-"));
  const src = join(root, "src");
  const dist = join(root, "dist");
  mkdirSync(src, { recursive: true });
  writeFixtureFiles([[join(dist, "out.js"), Date.now()]]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `an empty src/ must not pass silently; got ${result.status}. stderr: ${result.stderr}`);
  assert.match(result.stderr, /has no files anywhere under it/, "a GENUINELY empty src/ must still get the empty-directory message");
});

test("an empty dist/ directory is an error, not a silent pass — even when src/ has real files", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-empty-dist-"));
  const src = join(root, "src");
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  writeFixtureFiles([[join(src, "top.ts"), Date.now()]]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `an empty dist/ must not pass silently; got ${result.status}. stderr: ${result.stderr}`);
});

test("BOTH src/ and dist/ pointed at empty directories at once is an error, not the pass QA measured on the real repo", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-empty-both-"));
  const src = join(root, "src");
  const dist = join(root, "dist");
  mkdirSync(src, { recursive: true });
  mkdirSync(dist, { recursive: true });

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(
    result.status,
    0,
    `two empty directories used to satisfy -Infinity < -Infinity and pass silently; got ${result.status}. stderr: ${result.stderr}`,
  );
});

/* ---------------------------------------------------------------------- */
/* newestMtime — the pure function directly, no subprocess: it is         */
/* exported specifically so its two sharpest edges can be pinned without  */
/* the noise of a spawned process and a real filesystem tree per test.    */
/* ---------------------------------------------------------------------- */

test("a mtime exactly at `now` is not future (does not throw); one millisecond past it is — the cutoff is strict `>`, at `now` itself, not some earlier margin", () => {
  const atNowRoot = mkdtempSync(join(tmpdir(), "ecosy-hooks-mtime-at-now-"));
  const pastFutureRoot = mkdtempSync(join(tmpdir(), "ecosy-hooks-mtime-one-past-"));
  const now = Date.now();
  try {
    writeFixtureFiles([[join(atNowRoot, "at-now.ts"), now]]);
    writeFixtureFiles([[join(pastFutureRoot, "one-past.ts"), now + 1]]);

    assert.doesNotThrow(() => newestMtime(atNowRoot, now), "a file exactly at `now` must not be treated as future");
    assert.throws(() => newestMtime(pastFutureRoot, now), /has a mtime in the future/, "one millisecond past `now` must be treated as future");
  } finally {
    rmSync(atNowRoot, { recursive: true, force: true });
    rmSync(pastFutureRoot, { recursive: true, force: true });
  }
});

/* 0039 round 5, "S7" in the brief: newestMtime passes its `now` argument
   down explicitly on every recursive call (see the comment beside it in
   tests/hooks.mjs) instead of letting a nested call's own default
   parameter read a fresh Date.now(). Almost unobservable through a spawned
   process — the drift between two real Date.now() reads a function call
   apart is usually a fraction of a millisecond — so this pins it directly:
   call newestMtime with an explicit `now` that is deliberately FAR in the
   past relative to the real clock, on a fixture whose only file sits in a
   NESTED subdirectory with an ordinary, RECENT-but-not-future mtime set
   to an exact millisecond via utimesSync.

   The mtime is set explicitly (via writeFixtureFiles/utimesSync) rather
   than left to whatever the filesystem stamps a freshly-written file with
   on purpose: this filesystem's mtimes carry sub-millisecond precision,
   and a fresh file's raw mtime can carry a fractional millisecond that
   sits ABOVE a `Date.now()` read a few microseconds later purely from
   integer-vs-fractional rounding — that would make this test throw
   "in the future" under BOTH the correct code and the S7 mutant, for a
   reason that has nothing to do with which `now` got threaded through the
   recursion. Pinning the fixture's mtime to a whole millisecond removes
   that confound (caught while writing this test, by getting exactly this
   false-throw-either-way result once — see round 5's "Kết quả" for the
   corrected reasoning). */
test("newestMtime judges a NESTED file against the `now` explicitly passed to the top call, not a fresh Date.now() read inside the recursive call", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-now-threading-"));
  const realNow = Date.now();
  const nestedFileMtime = realNow - 1_000; // ordinary and recent by the REAL clock — 1s ago, not future
  const explicitOldNow = realNow - 10 * 60_000; // 10 minutes before the real clock — the nested file IS ahead of this

  writeFixtureFiles([[join(root, "utils", "nested.ts"), nestedFileMtime]]);

  try {
    assert.throws(
      () => newestMtime(root, explicitOldNow),
      /has a mtime in the future/,
      "the nested file's mtime (1s before the real clock) is ahead of the explicit `now` passed to the top call (10 minutes before the real clock) — if the recursive call dropped that argument and read a fresh Date.now() instead, it would compare the file against the REAL current time (which the file is NOT ahead of) and never throw",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
