/* Net under `tests/hooks.mjs` itself — the mtime guard that every other
   test file in this repo runs behind (`--import ./tests/hooks.mjs`).

   0039 round 2 added the guard; round 3 added this file after QA found it
   had NO net of its own; round 4 rewrote it around an "exclude a future
   mtime, warn once" design (a silent false negative); round 5 made it
   fail-closed on ANY future mtime, on EITHER side, with a 0ms tolerance —
   correct direction, but a file 1ms ahead of `now` (ordinary filesystem
   write jitter, not a real clock problem — see this task's Kết quả for the
   2000-file experiment) crashed the WHOLE suite (pass=0 fail=6).

   0046 rewrites this file's shape a fourth time, and this time it is
   ASYMMETRIC: src/ never throws on a future mtime by itself (see
   `newestMtimeRaw`); dist/ still fails closed immediately on one (see
   `newestMtimeFailClosed`); the top-level comparison decides pass/fail and
   builds ONE of two messages only on the failure path. The fixtures below
   are shaped around that split — several of round 5's fixtures still apply
   unchanged (staleness that has nothing to do with the future), and several
   are new because round 5's OWN behavior (any future mtime throws
   immediately, unconditionally) no longer holds. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newestMtimeRaw, newestMtimeFailClosed } from "./hooks.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksPath = join(repoRoot, "tests", "hooks.mjs");

/** Writes `files` (an array of [path, mtimeMs]) under `root`, creating parent
 *  directories as needed, with atime AND mtime both pinned to the same
 *  value via `utimesSync` — this is the fixture round 5 already used, kept
 *  unchanged for every test that isn't specifically about atime/ctime
 *  diverging from mtime (see the M13/M13b tests near the bottom, which use
 *  a dedicated helper instead of changing this one — this one has callers
 *  all over this file that assume atime tracks mtime). */
function writeFixtureFiles(files) {
  for (const [path, mtimeMs] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "// fixture file for tests/hooks.test.mjs\n");
    const d = new Date(mtimeMs);
    utimesSync(path, d, d);
  }
}

/** Writes ONE file with an mtime and an atime pinned to DIFFERENT values —
 *  a dedicated helper (rather than a parameter added to writeFixtureFiles)
 *  so every other fixture in this file keeps behaving exactly like round 5,
 *  and so a reader sees at the call site, not buried in a shared helper,
 *  that this particular fixture is deliberately abnormal. */
function writeFixtureFileWithDivergentAtime(path, mtimeMs, atimeMs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "// fixture file for tests/hooks.test.mjs (atime != mtime on purpose)\n");
  utimesSync(path, new Date(atimeMs), new Date(mtimeMs));
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

/* ========================================================================
 * 1. Ordinary staleness — unaffected by the asymmetric redesign, because
 *    none of these mtimes are in the future. Kept from round 5 essentially
 *    unchanged: this is the base case the guard exists for in the first
 *    place, and it must keep working no matter how the future-mtime edges
 *    get reshuffled around it.
 * ======================================================================== */

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
  assert.match(result.stderr, /run `yarn build`/i, "an honest, non-future staleness must give the plain rebuild remedy, not the clock-skew one");
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

test("dist/ exactly as new as src/'s newest file counts as fresh — the comparison is strict `<`, not `<=` [kills R3]", () => {
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

test("an empty src/ directory is an error, not a silent pass — even when dist/ has real files [kills R4]", () => {
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

test("an empty dist/ directory is an error, not a silent pass — even when src/ has real files [kills R4]", () => {
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

test("BOTH src/ and dist/ pointed at empty directories at once is an error, not the pass QA measured on the real repo [kills R4]", () => {
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

/* ========================================================================
 * 2. Việc 1 — the asymmetric shape itself.
 * ======================================================================== */

test("newestMtimeRaw NEVER throws on a future mtime and reports it raw, unclamped — this is the src/ side of the asymmetric design; whether the overall guard fails is decided later, by comparing against dist/, not by this function", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-raw-no-throw-"));
  const now = Date.now();
  const futurePath = join(root, "future.ts");
  writeFixtureFiles([[futurePath, now + 3_600_000]]); // 1 hour ahead
  try {
    const futureFiles = [];
    const result = newestMtimeRaw(root, now, futureFiles);
    assert.ok(Math.abs(result - (now + 3_600_000)) < 1, `the raw future mtime must come back unmodified — no clamp, no exclusion (got ${result}, expected ~${now + 3_600_000})`);
    assert.deepEqual(futureFiles, [futurePath], "the future file must be recorded for the caller's failure-path message, but the call itself must not throw");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newestMtimeFailClosed throws immediately on a future mtime, without needing any comparison against another tree — this is the dist/ side of the asymmetric design", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-failclosed-throws-"));
  const now = Date.now();
  const futurePath = join(root, "future.js");
  writeFixtureFiles([[futurePath, now + 3_600_000]]);
  try {
    assert.throws(() => newestMtimeFailClosed(root, now), /has a mtime in the future/, "dist/'s reduction must throw the moment it sees a future file, unlike src/'s");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a future-dated file under dist/ fails closed immediately, naming the exact file — round 4's hole reopened on the wrong side [kills M16, M16b]", () => {
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
  assert.match(result.stderr, /in dist\//, "the message must be the dist/-specific one, not the src/ clock-skew one");
});

test("src/ genuinely edited but not rebuilt, with THAT SAME file's mtime also drifted into the future, and dist/ stale — still fails, not the silent 100/100 green round 4 produced on the real repo [kills the round-4 hole]", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-round4-hole-");
  const now = Date.now();
  const editedFuturePath = join(src, "context.ts");
  writeFixtureFiles([
    [editedFuturePath, now + 3_600_000], // the edited file, ALSO future — round 4 excluded exactly this one
    [join(dist, "out.js"), now - 500_000], // stale build
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `round 4's silent-pass hole must stay closed; got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes(editedFuturePath), "the message must name the very file whose future timestamp caused this — round 4's bug was excluding exactly this file");
});

test("src/ genuinely edited (ordinary, non-future mtime), dist/ not rebuilt, and a SEPARATE dist/ file stamped into the future — still fails via the dist/ side [kills M16]", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-m16-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "context.ts"), now - 1_000], // real, ordinary, un-rebuilt edit
    [join(dist, "old.js"), now - 500_000],
    [join(dist, "future.js"), now + 3_600_000], // a dist/ file claiming to be from the future
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `M16 (delete the future check entirely) would pass this silently; got ${result.status}. stderr: ${result.stderr}`);
  assert.match(result.stderr, /future\.js/, "the message must name the actual future dist/ file that caused the failure");
});

test("an honest, un-rebuilt src/ edit with NO future mtime anywhere gets the plain 'run yarn build' message, not the clock-skew one", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-honest-edit-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "top.ts"), now - 5_000], // "just edited", ordinary mtime
    [join(dist, "out.js"), now - 100_000], // stale build
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `expected non-zero exit; got ${result.status}. stderr: ${result.stderr}`);
  assert.match(result.stderr, /dist\/ is older than src\/.*Run `yarn build`/s, "an honest edit must get the plain rebuild message");
  assert.doesNotMatch(result.stderr, /mtime in the future/, "an honest edit must NOT be reported as a clock-skew problem — there isn't one");
});

test("a src/ file with a mtime in the future makes the guard fail via the src/-vs-dist/ comparison, naming the exact file and BOTH remedies that can resolve it (touch, or fix the clock) — this replaces round 5's 'always throws immediately' test, which is no longer this file's behavior on purpose", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-future-src-");
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

  assert.notEqual(result.status, 0, `a future mtime under src/ that outruns dist/ must still fail; got ${result.status}. stderr: ${result.stderr}`);
  assert.ok(result.stderr.includes(futurePath), "the error must name the exact file, not just say something is in the future");
  assert.match(result.stderr, /find .* -exec touch/, "the error must give a one-shot remedy command");
  assert.match(result.stderr, /clock/, "the error must mention the other real remedy (fixing the system clock)");
  assert.doesNotMatch(result.stderr, /in dist\//, "this must be the src/-flavored message, not the dist/ one");
});

/* ========================================================================
 * 3. Việc 5 — the failure message must name EVERY future file it found,
 *    not just the first, and give ONE remedy command that covers all of
 *    them regardless of how many there are.
 * ======================================================================== */

test("when MULTIPLE src/ files are future-dated, the failure message names all of them (not just the first) and gives one remedy command covering the whole tree", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-multi-future-");
  const now = Date.now();
  const p1 = join(src, "a-future.ts");
  const p2 = join(src, "b-future.ts");
  const p3 = join(src, "utils", "c-future.ts");
  writeFixtureFiles([
    [p1, now + 60_000],
    [p2, now + 120_000],
    [p3, now + 180_000],
    [join(dist, "out.js"), now - 10_000],
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(result.status, 0, `expected non-zero exit; got ${result.status}. stderr: ${result.stderr}`);
  for (const p of [p1, p2, p3]) {
    assert.ok(result.stderr.includes(p), `the message must name ${p}, not just the first future file found`);
  }
  assert.match(result.stderr, /find .* -exec touch \{\} \+/, "the message must give a single command that resets every future file in one shot, not one `touch` per file");
});

/* ========================================================================
 * 4. Việc 2 — M7 / M7b / M7c: the reduction must be an actual max, not
 *    "whichever file (or subdirectory) is visited last wins". Every
 *    fixture below self-checks the REAL readdirSync order before asserting
 *    anything about position — this filesystem happens to hand back
 *    entries in a stable (alphabetical-looking) order, but that is not a
 *    promise `readdirSync` makes anywhere, so the test fails loudly instead
 *    of silently passing if that ever stops holding here.
 * ======================================================================== */

function positionOf(dir, name) {
  return readdirSync(dir).indexOf(name);
}

/* This filesystem's `utimesSync` round-trip does not always come back
   bit-for-bit exact — measured a consistent -0.001ms offset on some
   writes (e.g. asking for 1_000 and reading back 999.999) — the same
   sub-millisecond noise round 5 had to dodge in its own fixtures. None of
   the tests below care about anything finer than "which whole file won",
   so every mtime comparison in this section goes through this helper
   instead of `assert.equal`, with a 1ms tolerance — tight enough that a
   mutant reporting the WRONG FILE's mtime (seconds to minutes away in
   every fixture below) still fails loudly. */
function assertCloseTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1, `${message} (got ${actual}, expected ~${expected})`);
}

/* One shared table run against BOTH reductions: for non-future mtimes,
   newestMtimeRaw and newestMtimeFailClosed must behave identically (the
   fail-closed one only diverges from the raw one when a mtime is actually
   in the future, which none of these are) — so the same fixture proves
   `Math.max` isn't "last file wins" on either side of the asymmetric
   design at once. */
for (const reducer of [
  ["newestMtimeRaw", (dir, now) => newestMtimeRaw(dir, now, [])],
  ["newestMtimeFailClosed", (dir, now) => newestMtimeFailClosed(dir, now)],
]) {
  const [reducerName, call] = reducer;

  test(`${reducerName}: newest file FIRST in readdirSync order still wins over older files that come after it [kills M7]`, () => {
    const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-pos-front-"));
    const now = Date.now();
    writeFixtureFiles([
      [join(root, "a.ts"), now - 1_000], // intended newest
      [join(root, "b.ts"), now - 50_000],
      [join(root, "c.ts"), now - 90_000],
    ]);
    try {
      assert.equal(positionOf(root, "a.ts"), 0, "fixture self-check failed: 'a.ts' is not first in this filesystem's real readdirSync order — the position this test claims to exercise is not the one it built");
      assertCloseTo(call(root, now), now - 1_000, "the newest file's mtime must win even though it is visited FIRST, not last — 'newest = mtimeMs' (dropping Math.max) would instead report whatever the LAST file happens to be");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`${reducerName}: newest file in the MIDDLE of readdirSync order still wins over older files on both sides of it [kills M7]`, () => {
    const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-pos-middle-"));
    const now = Date.now();
    writeFixtureFiles([
      [join(root, "a.ts"), now - 90_000],
      [join(root, "b.ts"), now - 1_000], // intended newest
      [join(root, "c.ts"), now - 50_000],
    ]);
    try {
      const order = readdirSync(root);
      assert.equal(order[0], "a.ts");
      assert.equal(order[1], "b.ts", "fixture self-check failed: 'b.ts' is not in the middle of this filesystem's real readdirSync order");
      assert.equal(order[2], "c.ts");
      assertCloseTo(call(root, now), now - 1_000, "the middle file's mtime must win");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`${reducerName}: newest file LAST in readdirSync order wins — the case every round-5 fixture happened to be, kept as one row of this table, not the whole table`, () => {
    const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-pos-end-"));
    const now = Date.now();
    writeFixtureFiles([
      [join(root, "a.ts"), now - 90_000],
      [join(root, "b.ts"), now - 50_000],
      [join(root, "c.ts"), now - 1_000], // intended newest
    ]);
    try {
      assert.equal(positionOf(root, "c.ts"), 2, "fixture self-check failed: 'c.ts' is not last in this filesystem's real readdirSync order");
      assertCloseTo(call(root, now), now - 1_000, "the last file's mtime must win");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`${reducerName}: newest file lives in a NESTED subdirectory, and an older top-level file comes AFTER that subdirectory in readdirSync order [kills M7 across the recursion boundary]`, () => {
    const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-pos-nested-"));
    const now = Date.now();
    writeFixtureFiles([
      [join(root, "sub", "nested.ts"), now - 1_000], // intended newest, inside a subdirectory
      [join(root, "zzz-top.ts"), now - 90_000], // older, but visited AFTER "sub" alphabetically
    ]);
    try {
      const order = readdirSync(root);
      assert.ok(order.indexOf("sub") < order.indexOf("zzz-top.ts"), "fixture self-check failed: 'sub' is not visited before 'zzz-top.ts' in this filesystem's real readdirSync order — 'newest = mtimeMs' on the FILE line would let 'zzz-top.ts' overwrite the bigger value the subdirectory already contributed");
      assertCloseTo(call(root, now), now - 1_000, "the nested file's mtime must win over the older top-level file visited after it");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("newestMtimeRaw: a bigger TOP-LEVEL mtime visited BEFORE a subdirectory is not lost when the recursive call's own result is folded in [kills M7c — Math.max dropped specifically at the recursive-call site]", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-pos-m7c-"));
  const now = Date.now();
  writeFixtureFiles([
    [join(root, "a-top.ts"), now - 1_000], // intended newest, visited BEFORE "sub"
    [join(root, "sub", "smaller.ts"), now - 90_000], // subdirectory's own max is smaller
  ]);
  try {
    const order = readdirSync(root);
    assert.ok(
      order.indexOf("a-top.ts") < order.indexOf("sub"),
      "fixture self-check failed: 'a-top.ts' is not visited before 'sub' — this test needs the top-level file's bigger value to already be in `newest` BEFORE the recursive call runs, so that call can overwrite it under the M7c mutant",
    );
    assertCloseTo(
      newestMtimeRaw(root, now, []),
      now - 1_000,
      "'newest = newestMtimeRaw(full, now, futureFiles)' (dropping Math.max at the recursive-call site) would let the subdirectory's SMALLER result overwrite the top-level file's bigger one",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newestMtimeRaw: Math.max at a recursive call, not Math.min — a nested file smaller than the running max must not shrink it [kills M7b]", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-pos-m7b-"));
  const now = Date.now();
  writeFixtureFiles([
    [join(root, "a-top.ts"), now - 1_000], // biggest, at the top level
    [join(root, "sub", "smaller.ts"), now - 90_000], // smaller, nested
  ]);
  try {
    assertCloseTo(
      newestMtimeRaw(root, now, []),
      now - 1_000,
      "Math.max(newest, mtimeMs) turned into Math.min(...) anywhere in the reduction would report the smaller nested value instead of the true newest",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ========================================================================
 * 5. Việc 3 — M12 / M12b: the module-level `now` this file compares
 *    against has to be the REAL current instant, not one shifted by a
 *    hard-coded amount in either direction. Both assertions below go
 *    through a real spawned subprocess and never pass `now` in themselves
 *    — a mutation to the module-level `const now = Date.now()` line has no
 *    other way to be observed from outside the process.
 * ======================================================================== */

test("a dist/ file 45 seconds in the future is caught by the real system clock [kills M12 — `now` shifted +60s would hide this, since 45s < 60s]", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-m12-");
  const now = Date.now();
  const futureDistPath = join(dist, "soon.js");
  writeFixtureFiles([
    [join(src, "top.ts"), now - 100_000],
    [futureDistPath, now + 45_000], // 45s ahead of the REAL clock
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.notEqual(
    result.status,
    0,
    `a 45s-future dist/ file must be caught by a `+"`now`"+` read from the real clock; a `+"`now`"+` shifted +60s would treat it as ordinary and pass. got ${result.status}. stderr: ${result.stderr}`,
  );
  assert.ok(result.stderr.includes(futureDistPath));
});

test("an ordinary src/ file 40 seconds in the PAST, with dist/ genuinely fresher, passes cleanly [kills M12b — `now` shifted -60s would make this ordinary file look future-dated]", () => {
  const { root, src, dist } = fixtureRoot("ecosy-hooks-m12b-");
  const now = Date.now();
  writeFixtureFiles([
    [join(src, "top.ts"), now - 40_000], // ordinary, 40s old — NOT future under the real clock
    [join(dist, "out.js"), now - 1_000], // genuinely fresher than src/
  ]);

  let result;
  try {
    result = spawnHooksAgainst(src, dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  assert.equal(
    result.status,
    0,
    `expected a clean pass under the real clock; a `+"`now`"+` shifted -60s would make the 40s-old src/ file look future-dated (40s ago is "after" 60s-in-the-past) and fail this. got ${result.status}. stderr: ${result.stderr}`,
  );
});

/* ========================================================================
 * 6. Việc 4 — M13 / M13b: the guard must read `mtimeMs` specifically, not
 *    `atimeMs` or `ctimeMs`. `writeFixtureFiles` above pins atime == mtime
 *    on purpose (most fixtures in this file want that), so a dedicated
 *    fixture is needed to pull them apart — see writeFixtureFileWithDivergentAtime.
 * ======================================================================== */

test("newestMtimeRaw reads mtimeMs, not atimeMs — a fixture with atime deliberately set far from mtime [kills M13]", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-m13-atime-"));
  const now = Date.now();
  const path = join(root, "f.ts");
  // atime is set to something FAR older than mtime — if the guard read
  // atimeMs instead of mtimeMs, it would report the far-older value here,
  // not the recent one this test actually pins as the file's mtime.
  writeFixtureFileWithDivergentAtime(path, now - 10_000, now - 900_000);
  try {
    assertCloseTo(
      newestMtimeRaw(root, now, []),
      now - 10_000,
      "expected the mtime (10s old); a `.mtimeMs` -> `.atimeMs` mutation would report the atime (900s old) instead",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newestMtimeRaw reads mtimeMs, not ctimeMs — ctime is set by the OS to the real wall-clock instant of the LAST utimesSync call, which is not the mtime value that call requested [kills M13b]", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-m13b-ctime-"));
  const now = Date.now();
  const path = join(root, "f.ts");
  // No divergent-atime helper needed here: ctime cannot be set directly by
  // userspace at all (unlike atime/mtime, there is no ctimes argument to
  // utimesSync) — it is always the real time of the metadata-changing
  // syscall. Pinning mtime far in the past (500s) via the ordinary
  // writeFixtureFiles helper is enough on its own to pull ctime (≈ real
  // "now", the moment this test runs) and mtime (500s before that) apart
  // by far more than any test-execution jitter could produce.
  writeFixtureFiles([[path, now - 500_000]]);
  try {
    const result = newestMtimeRaw(root, now, []);
    assertCloseTo(result, now - 500_000, "expected the mtime (500s old); a `.mtimeMs` -> `.ctimeMs` mutation would report ctime, which is close to the REAL current time this test ran, not 500s in the past");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ========================================================================
 * 7. Việc 1's other mandatory measurement: writing a file and reading its
 *    mtime back immediately must never trip the future-mtime guard, even
 *    though `statSync().mtimeMs` can carry a sub-millisecond fraction
 *    above a `Date.now()` read a moment later.
 *
 *    IMPORTANT, and measured the hard way while writing this test: this
 *    has to call `newestMtimeFailClosed` directly, in the SAME process
 *    that did the write — routing it through `spawnHooksAgainst` (a fresh
 *    child process per trial) very nearly never reproduces the bug,
 *    because spawning a child and importing this module costs tens of
 *    milliseconds, which completely swamps the sub-millisecond drift being
 *    tested for. Measured directly in-process (no spawn) over 2000 writes:
 *    the correct `Math.floor` comparison threw 0/2000 times; `Math.ceil`
 *    (B1) threw 1979/2000; the raw comparison with no rounding at all (B2,
 *    the original round-5 bug) threw 1977/2000 — see this task's Kết quả.
 *    A smaller trial count is used here to keep this file fast; it is
 *    still overwhelmingly likely to catch either boundary mutant given a
 *    ~99% per-trial hit rate. */

test("newestMtimeFailClosed never trips on a file written and read back immediately, in the SAME process (no subprocess latency masking the sub-millisecond jitter) [kills B1, B2 — the sub-millisecond floor boundary]", () => {
  const trials = 200;
  let failures = 0;
  let firstError = null;
  for (let i = 0; i < trials; i++) {
    const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-subms-"));
    writeFileSync(join(root, "out.js"), "// y\n"); // no utimesSync — raw, whatever the FS gives it
    const now = Date.now();
    try {
      newestMtimeFailClosed(root, now);
    } catch (err) {
      failures++;
      if (!firstError) firstError = err.message;
    }
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(failures, 0, `expected 0/${trials} false throws from sub-millisecond write jitter; got ${failures}. First error: ${firstError}`);
});

/* ========================================================================
 * newestMtime — round 5's two edge-pinning tests, updated for the new
 * export names and the new asymmetric semantics (the strict `>` cutoff at
 * `now` itself, and explicit `now`-threading through recursion, both still
 * apply to newestMtimeRaw exactly as they did to the old newestMtime).
 * ======================================================================== */

test("newestMtimeRaw: a mtime exactly at `now` is not future; one millisecond past it IS recorded as future — the cutoff is strict `>`, at `now` itself, not some earlier margin", () => {
  const atNowRoot = mkdtempSync(join(tmpdir(), "ecosy-hooks-mtime-at-now-"));
  const pastFutureRoot = mkdtempSync(join(tmpdir(), "ecosy-hooks-mtime-one-past-"));
  const now = Date.now();
  try {
    writeFixtureFiles([[join(atNowRoot, "at-now.ts"), now]]);
    writeFixtureFiles([[join(pastFutureRoot, "one-past.ts"), now + 1]]);

    const atNowFuture = [];
    newestMtimeRaw(atNowRoot, now, atNowFuture);
    assert.deepEqual(atNowFuture, [], "a file exactly at `now` must not be treated as future");

    const pastFutureFiles = [];
    newestMtimeRaw(pastFutureRoot, now, pastFutureFiles);
    assert.equal(pastFutureFiles.length, 1, "one millisecond past `now` must be recorded as future");
  } finally {
    rmSync(atNowRoot, { recursive: true, force: true });
    rmSync(pastFutureRoot, { recursive: true, force: true });
  }
});

/* 0039 round 5, "S7" in the brief: the reduction passes its `now` argument
   down explicitly on every recursive call instead of letting a nested
   call's own default parameter read a fresh Date.now(). Almost
   unobservable through a spawned process — the drift between two real
   Date.now() reads a function call apart is usually a fraction of a
   millisecond — so this pins it directly: call newestMtimeRaw with an
   explicit `now` that is deliberately FAR in the past relative to the real
   clock, on a fixture whose only file sits in a NESTED subdirectory with
   an ordinary, RECENT-but-not-future mtime set to an exact millisecond via
   utimesSync.

   The mtime is set explicitly (via writeFixtureFiles/utimesSync) rather
   than left to whatever the filesystem stamps a freshly-written file with
   on purpose: this filesystem's mtimes carry sub-millisecond precision,
   and a fresh file's raw mtime can carry a fractional millisecond that
   sits ABOVE a `Date.now()` read a few microseconds later purely from
   integer-vs-fractional rounding — that would make this test's outcome
   ambiguous for a reason that has nothing to do with which `now` got
   threaded through the recursion. Pinning the fixture's mtime to a whole
   millisecond removes that confound (round 5's own note on getting exactly
   this false-throw-either-way result once while writing this test). */
test("newestMtimeRaw judges a NESTED file against the `now` explicitly passed to the top call, not a fresh Date.now() read inside the recursive call", () => {
  const root = mkdtempSync(join(tmpdir(), "ecosy-hooks-now-threading-"));
  const realNow = Date.now();
  const nestedFileMtime = realNow - 1_000; // ordinary and recent by the REAL clock — 1s ago, not future
  const explicitOldNow = realNow - 10 * 60_000; // 10 minutes before the real clock — the nested file IS ahead of this

  writeFixtureFiles([[join(root, "utils", "nested.ts"), nestedFileMtime]]);

  try {
    const futureFiles = [];
    newestMtimeRaw(root, explicitOldNow, futureFiles);
    assert.equal(
      futureFiles.length,
      1,
      "the nested file's mtime (1s before the real clock) is ahead of the explicit `now` passed to the top call (10 minutes before the real clock) — if the recursive call dropped that argument and read a fresh Date.now() instead, it would compare the file against the REAL current time (which the file is NOT ahead of) and never record it as future",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
