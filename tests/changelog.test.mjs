/* Task 0027: CHANGELOG.md and package.json's `files`/`version` are the
   PRODUCT of this task — there is no other logic to test. Every claim this
   guard makes is a claim about a package sitting on disk (dist/, the doc
   itself, git history), same style as `tests/no-core-dep.test.mjs`.

   A CHANGELOG that says something false about the package is worse than no
   CHANGELOG, because people trust it. This file is what makes trusting it
   reasonable — so every "không được X" below is written as a test that goes
   LOOKING for a violating case, not one that merely confirms today's file is
   fine. Where a check's own logic could be quietly weakened (an `===`
   loosened to `.startsWith`, a loop's assertion swapped for a tautology, an
   extraction regex broadened to swallow more than it should, or narrowed
   until it returns nothing), there is also a small unit test of that check's
   *own* function against a synthetic case built to expose exactly that
   weakening — real CHANGELOG data alone would still "pass" under most of
   those weakenings, since real data is, today, correct. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { surfaceOf } from "./support/surface.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(repoRoot, "CHANGELOG.md");
const distDir = join(repoRoot, "dist");

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const changelog = readFileSync(changelogPath, "utf8");
const fixture = JSON.parse(readFileSync(join(repoRoot, "tests/support/published-surface.json"), "utf8"));

/* ---------------------------------------------------------------------- *
 * Shared, pure functions. Each one is unit-tested against a synthetic
 * case BELOW its real-data use, not just exercised implicitly.
 * ---------------------------------------------------------------------- */

/** Every `## X.Y.Z` heading, top-level only — three "#" or more (`### `,
 *  `#### `) never matches, because after the required two "#" the regex
 *  demands a literal space, and a third "#" is not one. In order of
 *  appearance. */
function extractHeadings(md) {
  const re = /^## (\d+\.\d+\.\d+)/gm;
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

/** Does the FIRST heading equal `version`, exactly? A separate function
 *  (not inlined into the test body) so a synthetic probe can pin the exact
 *  comparison used — `===`, not a prefix check, and not `.at(-1)`. */
function firstHeadingMatchesVersion(headings, version) {
  return headings[0] === version;
}

/** The `## X.Y.Z ...` section of `md` up to (not including) the next
 *  top-level heading, or end of file. Same two-hash rule as above. */
function sectionOf(md, version) {
  const startRe = new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b.*$`, "m");
  const startMatch = startRe.exec(md);
  if (!startMatch) throw new Error(`no "## ${version}" heading found`);
  const start = startMatch.index + startMatch[0].length;
  const rest = md.slice(start);
  const nextRe = /^## /m;
  const nextMatch = nextRe.exec(rest);
  return nextMatch ? rest.slice(0, nextMatch.index) : rest;
}

/** Text strictly between `<!-- surface:NAME -->` and `<!-- /surface:NAME -->`.
 *  Throws — a red test, not a silent [] — if either tag is missing, per the
 *  task's own rule: "một neo thiếu hoặc không đóng → test đỏ". */
function anchorBlock(md, name) {
  const open = `<!-- surface:${name} -->`;
  const close = `<!-- /surface:${name} -->`;
  const start = md.indexOf(open);
  const end = md.indexOf(close);
  if (start === -1) throw new Error(`anchor "${open}" not found in CHANGELOG.md`);
  if (end === -1) throw new Error(`anchor "${close}" not found in CHANGELOG.md`);
  if (end < start) throw new Error(`anchor "${name}" is closed before it opens`);
  return md.slice(start + open.length, end);
}

/** Every backtick-wrapped identifier in `text`, in order, duplicates kept —
 *  duplicates matter for the "did the regex even find anything" check, not
 *  for set comparisons (those dedupe via `setEqual`/`diffNames` below). */
function backtickNames(text) {
  const re = /`([A-Za-z_$][\w$]*)`/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/** True iff `a` and `b` contain exactly the same set of values — checked
 *  BOTH directions at once (sorted-array deep-equal), so a CHANGELOG that
 *  merely lists a subset of what it should, or a superset, is caught either
 *  way. */
function setEqual(a, b) {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  return JSON.stringify(sa) === JSON.stringify(sb);
}

/** `{ missingFromA, extraInA }` — what `b` has that `a` doesn't, and what
 *  `a` has that `b` doesn't. Kept as two clearly-attributed arrays (rather
 *  than folded into one boolean) so a mutation that swaps which side feeds
 *  which check is something a synthetic probe can catch directly, and so a
 *  real failure message says which direction broke. */
function diffNames(a, b) {
  const sb = new Set(b);
  const sa = new Set(a);
  return {
    missingFromA: [...sb].filter((x) => !sa.has(x)).sort(),
    extraInA: [...sa].filter((x) => !sb.has(x)).sort(),
  };
}

const BANNED = [
  "mạnh mẽ", "toàn diện", "đáng kể", "vượt trội", "tối ưu hoá",
  "powerful", "robust", "comprehensive", "seamless", "blazing",
  "cutting-edge", "state-of-the-art", "game-chang", "revolution",
];

/** Every banned word found in `text`, case-insensitive, as a fresh array —
 *  never mutates `BANNED` itself. */
function scanBanned(text) {
  const lower = text.toLowerCase();
  return BANNED.filter((w) => lower.includes(w.toLowerCase()));
}

function fileExists(root, rel) {
  return existsSync(join(root, rel));
}

/** Contiguous blocks of `|`-prefixed lines within `text`; for each block the
 *  first two lines (header + `|---|` separator) are dropped, and the rest —
 *  the actual data rows — are returned, trimmed, across ALL tables found. */
function tableDataRows(text) {
  const lines = text.split("\n");
  const rows = [];
  let block = [];
  const flush = () => {
    if (block.length > 2) rows.push(...block.slice(2));
    block = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith("|")) block.push(line);
    else flush();
  }
  flush();
  return rows.map((r) => r.trim()).filter(Boolean);
}

/* ---------------------------------------------------------------------- *
 * Synthetic probes for the extraction/comparison functions above — built
 * to fail if the exact weakening a mutant would apply were present.
 * ---------------------------------------------------------------------- */

test("extractHeadings: only ## headings, sub-headings never match", () => {
  const sample = "## 1.2.3\n### not this\n#### nor this\ntext\n## 4.5.6\n";
  assert.deepEqual(extractHeadings(sample), ["1.2.3", "4.5.6"]);
});

test("firstHeadingMatchesVersion: exact equality of the FIRST element, not a prefix and not the last", () => {
  assert.equal(firstHeadingMatchesVersion(["9.9.9", "1.0.0", "2.0.0"], "9.9.9"), true);
  // a real mismatch must stay a mismatch
  assert.equal(firstHeadingMatchesVersion(["9.9.9"], "8.8.8"), false);
  // a PREFIX relationship must not read as a match either direction —
  // this is exactly what `.startsWith(` in place of `===` would get wrong
  assert.equal(firstHeadingMatchesVersion(["2.0"], "2.0.0"), false);
  assert.equal(firstHeadingMatchesVersion(["2.0.0"], "2.0"), false);
  // the LAST element must not be read instead of the first
  assert.equal(firstHeadingMatchesVersion(["1.0.0", "9.9.9"], "1.0.0"), true);
});

test("setEqual: symmetric — a superset OR a subset on either side both count as a mismatch", () => {
  assert.equal(setEqual(["a", "b"], ["a", "b"]), true);
  assert.equal(setEqual(["a", "b"], ["a", "b", "c"]), false);
  assert.equal(setEqual(["a", "b", "c"], ["a", "b"]), false);
  assert.equal(setEqual(["a", "b"], ["b", "a"]), true); // order-independent
});

test("diffNames: attributes an extra/missing element to the correct side, not swapped", () => {
  const { missingFromA, extraInA } = diffNames(["x", "y"], ["x", "y", "z"]);
  assert.deepEqual(missingFromA, ["z"]);
  assert.deepEqual(extraInA, []);

  const flipped = diffNames(["x", "y", "z"], ["x", "y"]);
  assert.deepEqual(flipped.missingFromA, []);
  assert.deepEqual(flipped.extraInA, ["z"]);
});

test("scanBanned: finds a planted word case-insensitively, and an empty BANNED list is not a passing state", () => {
  assert.ok(BANNED.length >= 14, "the banned-word list itself must not have been thinned out");
  assert.deepEqual(scanBanned("Đây là một tính năng Toàn Diện của gói."), ["toàn diện"]);
  assert.deepEqual(scanBanned("nothing wrong with this sentence"), []);
});

test("fileExists: correctly reports a path that is NOT on disk, not just paths that are", () => {
  assert.equal(fileExists(repoRoot, "this-file-does-not-exist-0027.md"), false);
  assert.equal(fileExists(repoRoot, "package.json"), true);
});

test("anchorBlock: a missing or unclosed anchor is an error, not an empty string", () => {
  assert.throws(() => anchorBlock("no anchors here", "removed-from-1.1.0"));
  assert.throws(() => anchorBlock("<!-- surface:x -->only opened", "x"));
});

test("backtickNames: extracts identifiers between backticks, in order", () => {
  assert.deepEqual(backtickNames("`Foo`, `bar`, not `1bad`, `_ok$`"), ["Foo", "bar", "_ok$"]);
});

/* ---------------------------------------------------------------------- *
 * T1 — the version heading and package.json must never disagree.
 * ---------------------------------------------------------------------- */

test("T1: the first CHANGELOG heading equals package.json's version, exactly", () => {
  const headings = extractHeadings(changelog);
  assert.ok(headings.length >= 3, "expected at least three release headings (2.0.0, 1.1.0, 1.0.2)");
  assert.deepEqual(headings.slice(0, 3), ["2.0.0", "1.1.0", "1.0.2"]);
  assert.ok(
    firstHeadingMatchesVersion(headings, pkg.version),
    `CHANGELOG's first heading ("${headings[0]}") does not match package.json's version ("${pkg.version}")`,
  );
});

/* ---------------------------------------------------------------------- *
 * The live public surface, read straight from the dist/ that is about to
 * be published. `surface.size === 75` is the cheapest gate in this whole
 * task (§B) and, per the task, "the one thing that kills a whole family of
 * mutants that make the reader return empty" — cross-checked a second way
 * against the fixture's own recorded 2.0.0 count, so deleting either one
 * assertion alone still leaves the other standing.
 * ---------------------------------------------------------------------- */

const surface = surfaceOf(distDir);

test("the live dist/ surface has exactly 75 public names across 15 modules", () => {
  assert.equal(surface.modules.length, 15);
  assert.equal(surface.names.size, 75);
  assert.equal(surface.names.size, fixture["2.0.0"].names, "must also agree with the fixture's own recorded 2.0.0 count");
});

/* ---------------------------------------------------------------------- *
 * The four named sets from the CHANGELOG's own anchor blocks.
 * ---------------------------------------------------------------------- */

const removedFrom10x = backtickNames(anchorBlock(changelog, "removed-from-1.0.x"));
const addedSince10x = backtickNames(anchorBlock(changelog, "added-since-1.0.x"));
const removedFrom110 = backtickNames(anchorBlock(changelog, "removed-from-1.1.0"));
const addedSince110 = backtickNames(anchorBlock(changelog, "added-since-1.1.0"));

/* ---------------------------------------------------------------------- *
 * T2 — every name CHANGELOG claims as newly exported must actually be
 * exported. Chống rỗng here is on the SHARED extraction regex
 * (`backtickNames`), across every anchor — not just the Added ones — since
 * one regex feeds T2, T3 and T4 alike; ≥ 20 catches that regex quietly
 * returning nothing (C9) regardless of which specific call site broke.
 * ---------------------------------------------------------------------- */

test("T2: every name CHANGELOG lists as Added actually exists in the dist/ surface", () => {
  const totalAnchorNames = removedFrom10x.length + addedSince10x.length + removedFrom110.length + addedSince110.length;
  assert.ok(totalAnchorNames >= 20, `expected at least 20 names across all four anchors, got ${totalAnchorNames}`);

  const addedNames = [...addedSince10x, ...addedSince110];
  const missing = addedNames.filter((n) => !surface.names.has(n));
  assert.deepEqual(missing, [], `CHANGELOG claims these are exported, but dist/ does not export them: ${missing.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * T3 — every name CHANGELOG says was removed must actually be gone.
 * ---------------------------------------------------------------------- */

test("T3: every name CHANGELOG lists as removed no longer exists in the dist/ surface", () => {
  assert.equal(removedFrom110.length, 12, "the 1.1.0 -> 2.0.0 removed list must be exactly 12 names");
  assert.equal(removedFrom10x.length, 11, "the 1.0.x -> 2.0.0 removed list must be exactly 11 names");

  const stillThere = [...removedFrom10x, ...removedFrom110].filter((n) => surface.names.has(n));
  assert.deepEqual(stillThere, [], `CHANGELOG claims these are gone, but dist/ still exports them: ${stillThere.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * T4 — CHANGELOG's own anchor lists must equal the fixture's recorded
 * lists, set-for-set, in both directions. This is the hard direction:
 * a name silently dropped from the CHANGELOG is invisible to T2/T3 (which
 * only check names that ARE mentioned) but not to this.
 * ---------------------------------------------------------------------- */

test("T4: CHANGELOG's removed-from-1.1.0 list equals the fixture's recorded set", () => {
  assert.ok(setEqual(removedFrom110, fixture["1.1.0"].removedIn200));
  const { missingFromA, extraInA } = diffNames(removedFrom110, fixture["1.1.0"].removedIn200);
  assert.deepEqual(missingFromA, [], `CHANGELOG is missing: ${missingFromA.join(", ")}`);
  assert.deepEqual(extraInA, [], `CHANGELOG has extra names not in the fixture: ${extraInA.join(", ")}`);
});

test("T4: CHANGELOG's added-since-1.1.0 list equals the fixture's recorded set", () => {
  assert.ok(setEqual(addedSince110, fixture["1.1.0"].addedIn200));
  const { missingFromA, extraInA } = diffNames(addedSince110, fixture["1.1.0"].addedIn200);
  assert.deepEqual(missingFromA, [], `CHANGELOG is missing: ${missingFromA.join(", ")}`);
  assert.deepEqual(extraInA, [], `CHANGELOG has extra names not in the fixture: ${extraInA.join(", ")}`);
});

test("T4: CHANGELOG's removed-from-1.0.x list equals the fixture's recorded set", () => {
  assert.ok(setEqual(removedFrom10x, fixture["1.0.2"].removedIn200));
  const { missingFromA, extraInA } = diffNames(removedFrom10x, fixture["1.0.2"].removedIn200);
  assert.deepEqual(missingFromA, [], `CHANGELOG is missing: ${missingFromA.join(", ")}`);
  assert.deepEqual(extraInA, [], `CHANGELOG has extra names not in the fixture: ${extraInA.join(", ")}`);
});

test("T4: CHANGELOG's added-since-1.0.x list equals the fixture's recorded set", () => {
  assert.ok(setEqual(addedSince10x, fixture["1.0.2"].addedIn200));
  const { missingFromA, extraInA } = diffNames(addedSince10x, fixture["1.0.2"].addedIn200);
  assert.deepEqual(missingFromA, [], `CHANGELOG is missing: ${missingFromA.join(", ")}`);
  assert.deepEqual(extraInA, [], `CHANGELOG has extra names not in the fixture: ${extraInA.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * Fixture self-check — the fixture is hand-typed, so it must be anchored
 * back to a LIVE dist/, not trusted as-is. These three assertions are what
 * kill a fixture widened past where the real surface supports it (the two
 * mandatory "nới biên" mutants, C15/C16).
 * ---------------------------------------------------------------------- */

test("fixture arithmetic: 70 - 11 + 16 === 75 and 81 - 12 + 6 === 75", () => {
  const f102 = fixture["1.0.2"];
  const f110 = fixture["1.1.0"];
  assert.equal(f102.names - f102.removedIn200.length + f102.addedIn200.length, 75);
  assert.equal(f110.names - f110.removedIn200.length + f110.addedIn200.length, 75);
});

test("fixture anchored to a LIVE dist/: every addedIn200 name is actually exported today", () => {
  const missing102 = fixture["1.0.2"].addedIn200.filter((n) => !surface.names.has(n));
  const missing110 = fixture["1.1.0"].addedIn200.filter((n) => !surface.names.has(n));
  assert.deepEqual(missing102, [], `fixture 1.0.2 addedIn200 claims these are exported, but they are not: ${missing102.join(", ")}`);
  assert.deepEqual(missing110, [], `fixture 1.1.0 addedIn200 claims these are exported, but they are not: ${missing110.join(", ")}`);
});

test("fixture anchored to a LIVE dist/: every removedIn200 name is actually gone today", () => {
  const stillThere102 = fixture["1.0.2"].removedIn200.filter((n) => surface.names.has(n));
  const stillThere110 = fixture["1.1.0"].removedIn200.filter((n) => surface.names.has(n));
  assert.deepEqual(stillThere102, [], `fixture 1.0.2 removedIn200 claims these are gone, but they are still exported: ${stillThere102.join(", ")}`);
  assert.deepEqual(stillThere110, [], `fixture 1.1.0 removedIn200 claims these are gone, but they are still exported: ${stillThere110.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * T5 — every path package.json's `files` names must exist on disk. This is
 * the exact class of bug this task fixes (`files: [..., "README.md"]` for a
 * README that has never existed), so this is the guard that must never
 * regress back to trusting `files` on faith.
 * ---------------------------------------------------------------------- */

test("T5: every entry in package.json's `files` exists on disk", () => {
  assert.ok(pkg.files.length >= 2, "expected at least dist and CHANGELOG.md");
  const missing = pkg.files.filter((f) => !fileExists(repoRoot, f));
  assert.deepEqual(missing, [], `package.json "files" lists a path that does not exist: ${missing.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * T6 — no inflated marketing language, anywhere in the file (including the
 * sections copied verbatim from the published 1.1.0 CHANGELOG).
 * ---------------------------------------------------------------------- */

test("T6: no banned marketing word appears anywhere in CHANGELOG.md", () => {
  const found = scanBanned(changelog);
  assert.deepEqual(found, [], `banned word(s) found in CHANGELOG.md: ${found.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * T7 — every claim in ## 2.0.0 must trace to a real commit or a task
 * number. Table rows only (the header + separator lines of each table are
 * skipped by `tableDataRows`) — that is where every factual claim in this
 * section lives; prose paragraphs explain a claim a table row already
 * sourced. Every 7-hex-digit sha found must resolve as a real commit in
 * THIS repo — a made-up sha is a made-up line.
 * ---------------------------------------------------------------------- */

const SHA_RE = /\b[0-9a-f]{7}\b/;
const TASK_RE = /\btask \d{4}\b/;

test("T7: every table row in ## 2.0.0 carries a sha or a task reference, and every sha is a real commit", () => {
  const section = sectionOf(changelog, "2.0.0");
  const rows = tableDataRows(section);
  assert.ok(rows.length >= 10, `expected at least 10 table rows in ## 2.0.0, found ${rows.length}`);

  const unsourced = rows.filter((r) => !SHA_RE.test(r) && !TASK_RE.test(r));
  assert.deepEqual(unsourced, [], `these rows in ## 2.0.0 carry no sha or task reference:\n${unsourced.join("\n")}`);

  const shas = new Set();
  for (const row of rows) {
    const re = /\b[0-9a-f]{7}\b/g;
    let m;
    while ((m = re.exec(row))) shas.add(m[0]);
  }
  assert.ok(shas.size > 0, "expected at least one sha reference in ## 2.0.0");

  const badShas = [];
  for (const sha of shas) {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot, stdio: "pipe" });
    } catch {
      badShas.push(sha);
    }
  }
  assert.deepEqual(badShas, [], `these shas referenced in ## 2.0.0 are not real commits in this repo: ${badShas.join(", ")}`);
});

test("sectionOf: stops at the NEXT top-level heading, not a sub-heading", () => {
  const sample = "## 2.0.0\nline one\n### sub\nline two\n## 1.1.0\nother stuff\n";
  assert.equal(sectionOf(sample, "2.0.0"), "\nline one\n### sub\nline two\n");
});

/* ---------------------------------------------------------------------- *
 * T8 — a heading must exist for every version this CHANGELOG talks about.
 * ---------------------------------------------------------------------- */

test("T8: a heading exists for 2.0.0, 1.1.0 and 1.0.2", () => {
  const headings = extractHeadings(changelog);
  for (const v of ["2.0.0", "1.1.0", "1.0.2"]) {
    assert.ok(headings.includes(v), `no "## ${v}" heading found in CHANGELOG.md`);
  }
});

/* Two invariants that no data-driven assertion above can pin, because
   today's data happens to already satisfy the weaker version too:
   hardcoding "2.0.0" in place of reading `pkg.version` in T1 is
   unobservable right now because `pkg.version` genuinely IS "2.0.0"; and
   deleting the literal `surface.names.size === 75` check (keeping only its
   cross-check against the fixture's OWN recorded 75) is unobservable
   because that cross-check still happens to equal 75 today. Both are real,
   constructible mutants — measured directly: applying either change by
   hand and rerunning this file leaves every assertion above green. So
   instead of leaving them silently alive, this last test pins them by
   reading this file's OWN source text, the same technique
   `tests/no-core-dep.test.mjs` uses to catch a dependency by scanning text
   rather than by running code. This test is placed LAST and excludes its
   own body from the scan (by cutting the source at its own start marker,
   found from the end), so the literal snippets it looks for cannot be
   satisfied by quoting themselves inside this test's own source — every
   line above this one is fair game, nothing at or after it is. */
/** How many times `needle` occurs in `haystack`, non-overlapping. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count += 1;
    from = idx + needle.length;
  }
}

test("this file's own T1/T2/T3/T4/size checks are still the real ones, not a tautology standing in for them", () => {
  const fullSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const ownTestMarker = "this file's own T1/T2/T3/T4/size checks are still the real ones";
  const markerIndex = fullSource.lastIndexOf(ownTestMarker);
  assert.ok(markerIndex > 0, "internal: this test could not find its own start marker");
  const src = fullSource.slice(0, markerIndex);

  assert.ok(
    src.includes("firstHeadingMatchesVersion(headings, pkg.version)"),
    "T1 must compare against `pkg.version` read from package.json, not a literal string standing in for it",
  );
  assert.ok(
    /assert\.equal\(surface\.names\.size,\s*75\)/.test(src),
    "the dist/ surface size must be pinned to the literal 75, not left to only agree with the fixture's own count",
  );

  /* T2 and T3 each check ONE real, data-derived array against `[]` — a
     mutation that swaps in a hardcoded `[]` (a tautology) or flips which
     way a `.filter()` predicate reads changes what these exact snippets
     say without changing whether real, already-correct data happens to
     pass. Counting occurrences catches both: a missing/duplicated snippet
     changes the count; the predicate check below catches the flip. */
  assert.equal(
    countOccurrences(src, 'assert.deepEqual(missing, [], `CHANGELOG claims these are exported'),
    1,
    "T2's real check (added names must be in the dist/ surface) must appear exactly once, unmodified",
  );
  assert.equal(
    countOccurrences(src, 'assert.deepEqual(stillThere, [], `CHANGELOG claims these are gone'),
    1,
    "T3's real check (removed names must NOT be in the dist/ surface) must appear exactly once, unmodified",
  );
  assert.ok(
    src.includes("filter((n) => !surface.names.has(n))"),
    "T2 must filter for added names that are MISSING from the surface (`!surface.names.has`), not present in it",
  );
  assert.ok(
    src.includes(
      "const stillThere = [...removedFrom10x, ...removedFrom110].filter((n) => surface.names.has(n));",
    ),
    "T3 must filter for removed names that ARE STILL in the surface (`surface.names.has`), not absent from it",
  );

  /* T4 has four groups (removed/added × 1.0.x/1.1.0), each checked in BOTH
     directions via `diffNames`. A one-way weakening (dropping one side, or
     replacing `deepEqual`/`diffNames` with a subset-only `.every()`) changes
     these counts from 4 to something else, on data too consistent today to
     otherwise reveal the difference. */
  assert.equal(countOccurrences(src, "assert.deepEqual(missingFromA, [], `CHANGELOG is missing"), 4);
  assert.equal(countOccurrences(src, "assert.deepEqual(extraInA, [], `CHANGELOG has extra names"), 4);
  assert.equal(countOccurrences(src, "assert.ok(setEqual("), 4);
  assert.equal(countOccurrences(src, ".every("), 0, "T4 must never fall back to a one-way `.every()` subset check");
});
