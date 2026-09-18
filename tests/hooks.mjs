/* `server-only` throws unless loaded under React's server condition, which only
   Next's own bundler sets. Outside Next it is swapped for an empty module. */
import { registerHooks } from "node:module";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const empty = new URL("./empty.cjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: empty, format: "commonjs", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/* 0039 mục 6: `pretest:run` closes the path where `yarn test:run` is typed
   verbatim, but it does that by rebuilding BEFORE `node --test` starts — it
   does nothing for the path that skips `yarn` entirely and runs `node
   --import ./tests/hooks.mjs --test tests/*.test.mjs` straight, which is
   exactly the command line every mutation-testing harness in this repo uses,
   QA's included. Mid-task, QA graded four tests against a `dist/` that was
   still the previous mutant's build, because nothing between the mutate step
   and the assert step forced a rebuild. This file is the one thing already
   sitting on *every* one of those paths — `--import` runs before a single
   test file loads — so the check belongs here, not in a script anyone can
   route around. */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/* Overridable via env, for `tests/hooks.test.mjs` only — it needs to point
   this exact guard at a disposable fixture directory instead of the real
   src/dist, so a test that deliberately sets a future mtime never touches
   a file the REST of the suite's own sibling processes read (each test
   file is its own process, but all of them run this same --import hook
   against the same real src/dist on disk; a future mtime set on a real
   src/ file, even for a few milliseconds, is visible to whichever sibling
   process happens to start its own hook check in that window — measured:
   ~2 of 10 runs right after a fresh build). Unset in every real run
   (`yarn test`, `yarn test:run`, CI), so production behavior is
   unchanged — this is a seam for the test file, not a new configuration
   surface. */
const srcDir = process.env.ECOSY_HOOKS_SRC_DIR ?? join(repoRoot, "src");
const distDir = process.env.ECOSY_HOOKS_DIST_DIR ?? join(repoRoot, "dist");

/* 0039 round 5 — QA measured that round 4's "exclude a future mtime, warn
   once" is a SILENT FALSE NEGATIVE, and a worse hole than round 3's ever-
   throwing one: on the real repo, breaking src/context.ts (commenting out
   `memory.delete`), setting that SAME file's mtime into the future, and
   leaving dist/ a stale build all passed 100/100 GREEN. Round 4's comment
   claimed "every OTHER file still counts normally, so a real, ordinary
   change to a sibling file is not hidden by the one bad timestamp" — but in
   the clock-skew case the file CARRYING the bad timestamp *is* the file
   that was just edited, not some uninvolved sibling; excluding it excludes
   exactly the change this guard exists to see. QA also measured the
   threshold that produced: +25ms got caught, +30ms and up passed — that
   is how long this guard's own startup takes, not a margin anyone chose.

   Back to fail-closed: a future mtime throws, no exclusion, no warning.
   What made round 3's throw a dead end was never that it exploded — it's
   that its message ("run `yarn build`") could never be followed: no
   rebuild moves a clock-skewed mtime back into the past. The message below
   names the exact file and states the two escapes that actually resolve
   it: touch that file back to now, or fix the clock. */
export function newestMtime(dir, now = Date.now()) {
  let newest = -Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Pass `now` down explicitly rather than letting the recursive call's
      // own default parameter read a fresh Date.now() — every file in the
      // tree, nested or not, is judged against the SAME instant, read once
      // at the top of this file. Without this, two files a few ms apart in
      // real wall-clock time could land on either side of "future" purely
      // because they were visited by different recursive calls.
      newest = Math.max(newest, newestMtime(full, now));
      continue;
    }
    const mtimeMs = statSync(full).mtimeMs;
    if (mtimeMs > now) {
      throw new Error(
        `${full} has a mtime in the future (file: ${new Date(mtimeMs).toISOString()}, checked against: ${new Date(now).toISOString()}) — a real edit cannot be dated after the instant this check runs. Run \`touch ${full}\` to reset its mtime to now, or fix the system clock, then re-run.`,
      );
    }
    newest = Math.max(newest, mtimeMs);
  }
  return newest;
}

if (!existsSync(distDir)) {
  throw new Error("dist/ does not exist — run `yarn build` before running tests.");
}

/* 0039 round 4 mục 3, still true here: an empty directory is a
   misconfiguration, not something this guard can read as "up to date".
   -Infinity out of newestMtime() means recursion never found a single file
   to throw on or reduce — which is a DIFFERENT condition from the one
   above (a real file with an untrustworthy mtime): this fires only when a
   root has no files anywhere under it, empty or not. Before round 4 this
   let ECOSY_HOOKS_*_DIR pointed at empty directories through in silence —
   measured: request-store.test.mjs then ran 16/16 green against a dist/
   nobody had rebuilt. */
function newestMtimeOrThrow(dir, label, now) {
  const value = newestMtime(dir, now);
  if (value === -Infinity) {
    throw new Error(`${label} (${dir}) has no files anywhere under it — an empty directory has nothing to check freshness against.`);
  }
  return value;
}

/* One `now`, read once here, threaded through both trees and every
   recursive call inside newestMtime — the whole comparison below is
   stamped against a SINGLE reference point, not two (or more) separate
   Date.now() reads taken microseconds apart by different call sites. */
const now = Date.now();

/* `readdirSync`/`statSync` recurse into every subdirectory under src/ (e.g.
   src/utils/), not just its top level — a check that only looked at src/'s
   immediate files would miss a change to src/utils/flatten.ts or
   src/utils/get.ts while still claiming dist/ is fresh. Both sides go
   through the same fail-closed, empty-rejecting reduction, against the
   same `now` — dist/ is written by this machine's own build at check time,
   so it should never legitimately carry a future mtime either, and there
   is no reason to trust one side's timestamps more than the other's. */
if (newestMtimeOrThrow(distDir, "dist/", now) < newestMtimeOrThrow(srcDir, "src/", now)) {
  throw new Error(
    "dist/ is older than src/ — these tests would run against a stale build and silently lie about the result. Run `yarn build` first (or `yarn test`, which does).",
  );
}

/* Known blind spot, not fixed by this file: this check compares mtimes, and
   mtimes are exactly what `cp -p` (or a git checkout, which sets mtime to
   checkout time but never PRESERVES a stale one either way) is designed to
   preserve. A harness that mutates src/, rebuilds, and restores src/ with
   `cp -p` instead of a plain `cp` puts src/'s mtime back to its pre-mutation
   value while dist/ still holds the mutant's build — dist/ then looks
   NEWER than the restored src/, this check says nothing is wrong, and the
   suite silently runs against the wrong dist/. Measured: patch a src/ file,
   `yarn build`, restore with `cp -p`, run the suite — this hook passes and
   the suite runs against the stale (mutant) dist/. Today's safety is
   `pipelines/tasks/0039-the-net-has-holes.md` requiring a plain `cp` for
   every mutation-testing restore in this repo, i.e. a CONVENTION, not
   anything this file can enforce — an mtime-based check has no way to tell
   "src/ was never touched" apart from "src/ was touched and then had its
   old mtime put back on purpose". */
