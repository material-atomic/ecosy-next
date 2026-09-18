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
   route around.

   That direct command line is also the FAST one — `yarn test:run` costs
   1.87s (it always rebuilds first via `pretest:run`); calling this file
   directly costs 0.62s, three times faster (measured, task 0039 Reviewer,
   0046's Kết quả). It is only safe to take that shortcut BECAUSE this file
   fails closed on a stale `dist/` — that is the whole reason nobody should
   "fix" a flaky run by deleting this check instead of fixing what it found. */

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

/* 0046 — this file's fourth shape, and each of the first three fixed one
   direction and broke the other:

     round 3 (0039): a future mtime got CLAMPED to `now` before comparing.
       dist/ freshly built always reads a mtime a moment before the NEXT
       `Date.now()` read, so the clamp made "dist/ is stale" permanently
       true right after a real build — a dead-end false positive, and its
       message ("run `yarn build`") could never be followed, because no
       rebuild moves anything back in time.
     round 4 (0039): a future mtime got EXCLUDED from the reduction instead,
       with a one-time warning. Measured on the real repo: break
       src/context.ts, let ITS OWN edit's mtime drift into the future, leave
       dist/ stale — 100/100 GREEN. Excluding the future file excluded
       exactly the edit this guard exists to see.
     round 5 (0039): back to fail-closed — ANY future mtime, on EITHER side,
       throws immediately. Correct direction, but its tolerance is 0ms, and
       0ms is below this filesystem's own write noise: writing 2000 files
       back to back and reading `mtimeMs` right after found 1968/2000 already
       reading past a `Date.now()` taken microseconds later (max delta
       ~0.99ms — sub-millisecond fractional bits in `mtimeMs` that
       `Date.now()` rounds away; see task 0046's Kết quả for the full
       experiment). A single file 1ms "ahead" of `now` purely from that
       jitter made the WHOLE suite fail to start (pass=0 fail=6 — one crash
       per test-file process, because every process re-imports this file and
       re-reads the same real src/dist trees).

   The fix this round is ASYMMETRIC, not a bigger shared tolerance:

   - src/ NEVER throws on a future mtime (see `newestMtimeRaw` below). It
     contributes its raw, unclamped, unexcluded mtimeMs to "newest file in
     this tree". A future mtime on a real src/ edit only pushes that tree's
     "newest" value UP, which can only push the src/-vs-dist/ comparison
     toward "dist/ looks older" — the safe wrong answer, and the one a real
     `yarn build` can resolve as long as the skew is smaller than the build
     itself takes: a rebuild stamps dist/ from the clock at BUILD time, well
     after the `now` this process read, so it overtakes any src/ file only
     that far ahead (measured: a 1ms, 30ms or 300ms skew is cleared by one
     ~0.8s build; an hour-ahead file is not, and stays failing until it is
     touched or the clock is fixed — which is why the failure message below
     offers both remedies instead of picking one). Throwing on this side
     bought round 5 nothing observable except the 0ms floor above.
   - dist/ DOES throw, immediately, on a future mtime (see
     `newestMtimeFailClosed` below) — this is the one direction that can
     hide a stale build: a dist/ file stamped into the future can outrun a
     src/ edit landing inside that same future window, and nothing else in
     this file would ever notice (this is round 4's hole again, reproduced
     as mutation M16b in this task's sweep). There is no tolerance here that
     isn't itself a hole of exactly that width — see the comment on
     `newestMtimeFailClosed`'s own threshold below.
   - The error message is built ONLY on the failure path (dist/ found older
     than src/), never while reading mtimes — see the comparison at the
     bottom of this file. */

/** Recursively finds the newest raw `mtimeMs` under `dir`, judged against a
 *  single `now` threaded through every recursive call (see the comment
 *  beside the module-level `now` further down for why one instant, read
 *  once, has to serve every file). This is the src/ side of the asymmetric
 *  design above: it NEVER throws on a future mtime, by design — see the
 *  comment above. Every file whose raw mtimeMs is later than `now` is
 *  pushed onto `futureFiles` (an array the caller owns and passes in), so a
 *  failure message assembled AFTER this call returns can name every one of
 *  them, not just whichever happened to end up "newest". */
export function newestMtimeRaw(dir, now, futureFiles = []) {
  let newest = -Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Pass `now` and `futureFiles` down explicitly rather than letting the
      // recursive call default `now` to a fresh Date.now() (same reasoning
      // as round 5's comment on the old newestMtime — every file in the
      // tree, nested or not, is judged against the SAME instant) — and so
      // that a future file three directories deep still lands in the same
      // list the top-level caller reads.
      newest = Math.max(newest, newestMtimeRaw(full, now, futureFiles));
      continue;
    }
    const mtimeMs = statSync(full).mtimeMs;
    if (mtimeMs > now) futureFiles.push(full);
    newest = Math.max(newest, mtimeMs);
  }
  return newest;
}

/** Recursively finds the newest `mtimeMs` under `dir`, but throws the
 *  moment it finds a file whose mtime is in the future — the dist/ side of
 *  the asymmetric design above, and the ONLY side of this file that can
 *  still throw while just reading mtimes (not only on the final
 *  comparison). Compares with `Math.floor(mtimeMs) > now`, not the raw
 *  value: `statSync().mtimeMs` carries sub-millisecond precision on this
 *  filesystem, and a file read back immediately after being written can
 *  carry a fractional millisecond ABOVE a `Date.now()` taken microseconds
 *  later, purely from integer-vs-fractional rounding (the same noise
 *  measured above for the 0ms floor). Measured: 1968/2000 false positives
 *  with a raw `mtimeMs > now` comparison, 0/2000 with `Math.floor(mtimeMs)
 *  > now`, over the same 2000-write experiment (0046 Kết quả has both
 *  numbers). `Math.floor` was chosen over a named tolerance constant
 *  (e.g. `DIST_FUTURE_TOLERANCE_MS`) on purpose: a constant here would BE
 *  the width of a hole — a dist/ file stamped up to that many ms into the
 *  future would still pass, silently covering a src/ edit landing in that
 *  same window — and the measured floor comparison closes it with no
 *  window at all. If this measurement ever stops holding on some other
 *  filesystem, the fallback is a constant chosen the same way: measured
 *  from a fresh 2000-file run on THAT filesystem, sized to the smallest
 *  value that reaches 0/2000, and named after that number in the test that
 *  proves it (see house-rules on picking dungsai from a measurement). */
export function newestMtimeFailClosed(dir, now) {
  let newest = -Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeFailClosed(full, now));
      continue;
    }
    const mtimeMs = statSync(full).mtimeMs;
    if (Math.floor(mtimeMs) > now) {
      throw new Error(
        `${full} in dist/ has a mtime in the future (file: ${new Date(mtimeMs).toISOString()}, checked against: ${new Date(now).toISOString()}) — dist/ is written by this machine's own build at check time, so it should never legitimately carry a future mtime. Unlike src/, this side fails closed immediately: a future dist/ mtime can hide a stale build (an older dist/ that only LOOKS newer than a real src/ edit landing in that same future window), and there is no tolerance here that would not itself be that hole. Run \`touch ${full}\` to reset its mtime to now, or fix the system clock, then re-run.`,
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
   -Infinity out of either reduction means recursion never found a single
   file to reduce — which is a DIFFERENT condition from a real file with an
   untrustworthy mtime: this fires only when a root has no files anywhere
   under it, empty or not. Before round 4 this let ECOSY_HOOKS_*_DIR point
   at empty directories through in silence — measured: request-store.test.mjs
   then ran 16/16 green against a dist/ nobody had rebuilt. */
function rejectIfEmpty(value, label, dir) {
  if (value === -Infinity) {
    throw new Error(`${label} (${dir}) has no files anywhere under it — an empty directory has nothing to check freshness against.`);
  }
  return value;
}

/* One `now`, read once here, threaded through both reductions and every
   recursive call inside them — the whole comparison below is stamped
   against a SINGLE reference point, not two (or more) separate Date.now()
   reads taken microseconds apart by different call sites. */
const now = Date.now();

/* dist/ goes through the fail-closed reduction: it is written by this
   machine's own build at check time, so a future mtime on it is always a
   clock problem, never a legitimate edit, and there is no reason to let it
   through (see newestMtimeFailClosed's comment on why no tolerance). */
const newestDist = rejectIfEmpty(newestMtimeFailClosed(distDir, now), "dist/", distDir);

/* src/ goes through the raw reduction: `readdirSync`/`statSync` recurse
   into every subdirectory (e.g. src/utils/), not just the top level — a
   check that only looked at src/'s immediate files would miss a change to
   src/utils/flatten.ts or src/utils/get.ts while still claiming dist/ is
   fresh. `futureSrcFiles` collects every file this reduction found in the
   future, for the message below — it is NOT used to decide whether to
   throw; only the dist/-vs-src/ comparison decides that. */
const futureSrcFiles = [];
const newestSrc = rejectIfEmpty(newestMtimeRaw(srcDir, now, futureSrcFiles), "src/", srcDir);

if (newestDist < newestSrc) {
  /* futureSrcFiles is non-empty if and only if newestSrc > now — any file
     that lands in that list has mtimeMs > now, and newestSrc is the max
     over ALL files, future ones included, so it can only be > now when at
     least one exists. That is exactly the condition that tells the two
     failure causes apart: an honest, un-rebuilt edit (no future files —
     `yarn build` fixes it) versus clock skew (a future file IS why src/
     looks newer, so a rebuild only fixes it when the skew is smaller than
     the build's own duration — it stamps dist/ from the clock at build
     time, not from this process's `now`). Do NOT simplify that into
     "`yarn build` cannot fix skew": measured, one build clears a
     1ms/30ms/300ms skew and does not clear an hour — which is exactly why
     the message built below names the files and offers `touch`/clock as
     the remedy that works at any size. See the comment on that message. */
  if (futureSrcFiles.length > 0) {
    // Việc 5: name every future file found, not just the first — QA counted
    // 19-21 of them on the real repo when this drifted, and a message that
    // only ever named the first one turns fixing this into 19-21 rounds of
    // touch-and-rerun. Nobody survives that many rounds; they delete the
    // guard instead. Truncate the LIST for readability, but the remedy
    // command below covers all of them in one shot regardless of count.
    const shown = futureSrcFiles.slice(0, 10);
    const more = futureSrcFiles.length > shown.length ? ` and ${futureSrcFiles.length - shown.length} more` : "";
    /* Deliberately NOT claiming "yarn build cannot fix this" here: whether a
       rebuild resolves it depends on how far in the future the skew reaches
       versus how long the build takes, and this guard has no way to know
       either of those in advance — a hard-coded threshold to decide would
       be exactly the kind of guessed number this design was written to
       avoid (see the comment on newestMtimeFailClosed above). Measured
       (0046 Kết quả): a 1ms/30ms/300ms skew is in practice cleared by a
       single `yarn build` (a real build takes well over 100ms, so the new
       dist/ mtime lands after the skewed file); a multi-hour skew is not.
       Both remedies are offered so the fix scales with the skew itself
       instead of the guard having to guess which one applies. */
    throw new Error(
      `dist/ looks older than src/, but at least part of the reason is a mtime in the future, not (only) a missed rebuild: ${futureSrcFiles.length} file(s) under src/ are dated after right now — ${shown.join(", ")}${more}. Reset every one of them in one shot and re-run: find ${srcDir} -type f -exec touch {} + — or fix the system clock. Running \`yarn build\` again may also clear a small skew (a fresh build reads a later clock), but only touching the files or fixing the clock is guaranteed to work for a larger one.`,
    );
  }
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
   old mtime put back on purpose". This round's asymmetric src/ side does
   not change this blind spot either way: it was never about future mtimes. */
