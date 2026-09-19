/* Task 0055. README.md ships INSIDE 2.0.0 — npm does not let a publish be
   overwritten, so every link and every code example in it is permanent from
   the moment `npm publish` runs. This file checks the package as a shipped
   artifact (README.md, package.json), the same style as
   `tests/changelog.test.mjs` and `tests/no-core-dep.test.mjs`: every "không
   được X" below is a test that goes LOOKING for a violating case, not one
   that only confirms today's file happens to be fine.

   08:02 19/09 (coordinator, relaying the user): the README itself must be
   real documentation of 2.0.0's public surface — not a pointer page with a
   caveat about what docs.ecosy.io does or does not cover yet. That is why
   this file has no R10: there is no "site hasn't caught up" sentence left
   to guard. What is still guarded, and guarded harder now that people will
   actually learn the API from this file instead of just being pointed
   elsewhere, is that every name and every example README makes is REAL —
   R2, R3, R4/R4b below. A wrong code example here is worse than a missing
   one: the reader pastes it and it breaks, or worse, it compiles against a
   loosened type and fails silently at runtime (exactly the `{ session,
   identity }` shape CHANGELOG.md's own 2.0.0 section documents). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { surfaceOf } from "./support/surface.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = join(repoRoot, "README.md");
const distDir = join(repoRoot, "dist");
const tscBin = join(repoRoot, "node_modules", ".bin", "tsc");

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const readme = readFileSync(readmePath, "utf8");

/* ---------------------------------------------------------------------- *
 * Shared, pure extraction functions — each one unit-tested against a
 * synthetic case below, the same discipline `tests/changelog.test.mjs`
 * uses, and for the same reason: real README data alone would still
 * "pass" under most weakenings of these functions, because today's README
 * happens to be correct.
 * ---------------------------------------------------------------------- */

/** Every fenced code block in `md`, in order, as `{ lang, lines }` — `lang`
 *  is the string right after the opening fence (may be ""), `lines` is the
 *  block body split on "\n" with the trailing empty element (from the
 *  final "\n" before the closing fence) dropped. */
function codeBlocks(md) {
  const re = /```([\w-]*)\n([\s\S]*?)```/g;
  const out = [];
  let m;
  while ((m = re.exec(md))) {
    const body = m[2];
    const lines = body.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    out.push({ lang: m[1], lines });
  }
  return out;
}

/** Text strictly between `<!-- readme:NAME -->` and `<!-- /readme:NAME -->`.
 *  Throws — a red test, not a silent "" — if either tag is missing or
 *  out of order, per the task's own rule: "một neo thiếu hoặc không đóng →
 *  test đỏ". */
function anchorBlock(md, name) {
  const open = `<!-- readme:${name} -->`;
  const close = `<!-- /readme:${name} -->`;
  const start = md.indexOf(open);
  const end = md.indexOf(close);
  if (start === -1) throw new Error(`anchor "${open}" not found in README.md`);
  if (end === -1) throw new Error(`anchor "${close}" not found in README.md`);
  if (end < start) throw new Error(`anchor "${name}" is closed before it opens`);
  return md.slice(start + open.length, end);
}

/** Every backtick-wrapped identifier in `text`, in order, duplicates kept. */
function backtickNames(text) {
  const re = /`([A-Za-z_$][\w$]*)`/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/** Every module specifier from `import … from "…"` and `require("…")` in
 *  `text`, in order. Handles both quote styles and `import type`. */
function importSpecifiers(text) {
  const out = [];
  const fromRe = /import\s+(?:type\s+)?(?:[\s\S]*?)\bfrom\s+["']([^"']+)["']/g;
  let m;
  while ((m = fromRe.exec(text))) out.push(m[1]);
  // a bare side-effect import, `import "x";`, has no `from` clause at all —
  // still a real module load, and still worth catching if it ever names
  // `@ecosy/next/something`.
  const bareRe = /import\s+["']([^"']+)["']/g;
  while ((m = bareRe.exec(text))) out.push(m[1]);
  const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = requireRe.exec(text))) out.push(m[1]);
  return out;
}

/** Maps a `@ecosy/next...` specifier to the exact key it would need in
 *  `package.json`'s `exports` — `"@ecosy/next"` -> `"."`,
 *  `"@ecosy/next/inject"` -> `"./inject"`. Returns `null` for a specifier
 *  that is not this package at all, so the caller can filter those out
 *  without also swallowing a real mismatch. */
function exportsKeyFor(specifier, pkgName) {
  if (specifier === pkgName) return ".";
  const prefix = `${pkgName}/`;
  if (!specifier.startsWith(prefix)) return null;
  return `./${specifier.slice(prefix.length)}`;
}

/** GitHub's heading-to-slug rule, close enough for this file's own
 *  headings: lowercase, strip everything but word characters/spaces/
 *  hyphens, collapse spaces to hyphens. */
function slugify(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-");
}

/** Every `## heading` (any level) in `md`, in order, text only. */
function headings(md) {
  const re = /^#{1,6}\s+(.+?)\s*$/gm;
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

/** Every `](#slug)` internal link target in `md`, in order. */
function internalLinkTargets(md) {
  const re = /\]\(#([^)\s]+)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

const BANNED = [
  "mạnh mẽ", "toàn diện", "đáng kể", "vượt trội", "tối ưu hoá",
  "powerful", "robust", "comprehensive", "seamless", "blazing",
  "cutting-edge", "state-of-the-art", "game-chang", "revolution",
];

/** Every banned word found in `text`, case-insensitive. */
function scanBanned(text) {
  const lower = text.toLowerCase();
  return BANNED.filter((w) => lower.includes(w.toLowerCase()));
}

/* ---------------------------------------------------------------------- *
 * Synthetic probes — built to fail if the exact weakening a mutant would
 * apply were present, per house-rules on Contains-with-a-short-string and
 * on "một khẳng định phổ quát cần một BẢNG".
 * ---------------------------------------------------------------------- */

test("codeBlocks: separates blocks by language and strips the trailing empty line only", () => {
  const sample = "```ts\nconst a = 1;\nconst b = 2;\n```\n\n```js\nvar x;\n```\n";
  const blocks = codeBlocks(sample);
  assert.deepEqual(blocks, [
    { lang: "ts", lines: ["const a = 1;", "const b = 2;"] },
    { lang: "js", lines: ["var x;"] },
  ]);
});

test("anchorBlock: a missing or unclosed anchor is an error, not an empty string", () => {
  assert.throws(() => anchorBlock("no anchors here", "api"));
  assert.throws(() => anchorBlock("<!-- readme:api -->only opened", "api"));
  assert.throws(() => anchorBlock("<!-- /readme:api -->before<!-- readme:api -->", "api"), /closed before it opens/);
});

test("backtickNames: extracts identifiers between backticks, in order, duplicates kept", () => {
  assert.deepEqual(backtickNames("`Foo`, `bar`, not `1bad`, `Foo` again"), ["Foo", "bar", "Foo"]);
});

test("importSpecifiers: reads both import and require, both quote styles, import type included", () => {
  const sample = [
    `import { Route } from "@ecosy/next";`,
    `import type { IdentityPort } from '@ecosy/next';`,
    `const x = require("@ecosy/next/inject");`,
    `import "server-only";`,
  ].join("\n");
  assert.deepEqual(importSpecifiers(sample), [
    "@ecosy/next",
    "@ecosy/next",
    "server-only",
    "@ecosy/next/inject",
  ]);
});

test("exportsKeyFor: maps the bare package name to '.', a subpath to './subpath', and rejects an unrelated package", () => {
  assert.equal(exportsKeyFor("@ecosy/next", "@ecosy/next"), ".");
  assert.equal(exportsKeyFor("@ecosy/next/inject", "@ecosy/next"), "./inject");
  assert.equal(exportsKeyFor("@ecosy/next/csrf", "@ecosy/next"), "./csrf");
  // the rejection this exists for: a longer sibling package name must not
  // be read as "this package plus a subpath" just because it starts with it
  assert.equal(exportsKeyFor("@ecosy/next-extra", "@ecosy/next"), null);
  assert.equal(exportsKeyFor("next/server", "@ecosy/next"), null);
});

test("slugify: matches GitHub's rule on the headings this file actually has", () => {
  assert.equal(slugify("Entry points"), "entry-points");
  assert.equal(slugify("cookieJar"), "cookiejar");
  assert.equal(slugify("CSRF"), "csrf");
});

test("headings: only ATX headings, any level, text trimmed", () => {
  const sample = "# Title\n\ntext\n## Sub Heading\nmore\n### Deep  \n";
  assert.deepEqual(headings(sample), ["Title", "Sub Heading", "Deep"]);
});

test("internalLinkTargets: finds a `](#slug)` target and ignores a normal https link", () => {
  const sample = "See [here](#some-heading) and [site](https://example.com).";
  assert.deepEqual(internalLinkTargets(sample), ["some-heading"]);
});

test("scanBanned: finds a planted word case-insensitively, and an empty BANNED list is not a passing state", () => {
  assert.ok(BANNED.length >= 14, "the banned-word list itself must not have been thinned out");
  assert.deepEqual(scanBanned("This is a Comprehensive package."), ["comprehensive"]);
  assert.deepEqual(scanBanned("nothing wrong with this sentence"), []);
});

test("scanBanned: still finds a planted word 500 characters in — a scanner that only reads the opening paragraph would miss this", () => {
  // Guards against narrowing scanBanned (or R7's call to it) to only the
  // first paragraph/line of the file — a real mutation shape (house-rules:
  // "một bảng ca chỉ có N=1 không phân biệt được gì về N", applied here to
  // POSITION within the text rather than array index).
  const longPrefix = "word ".repeat(120); // 600 chars of harmless filler
  assert.deepEqual(scanBanned(`${longPrefix}this package is state-of-the-art.`), ["state-of-the-art"]);
});

/* ---------------------------------------------------------------------- *
 * R1 — README must exist and stay within the size the task set (C3):
 * 120-200 lines, at most 3 `ts` code blocks, each at most 20 lines.
 * ---------------------------------------------------------------------- */

test("R1: README.md exists, has 120-200 lines, at most 3 `ts` blocks, each at most 20 lines", () => {
  assert.ok(existsSync(readmePath), "README.md does not exist");

  const body = readme.endsWith("\n") ? readme.slice(0, -1) : readme;
  const lineCount = body.split("\n").length;
  assert.ok(lineCount >= 120 && lineCount <= 200, `README.md has ${lineCount} lines, expected 120-200`);

  const tsBlocks = codeBlocks(readme).filter((b) => b.lang === "ts" || b.lang === "tsx");
  assert.ok(tsBlocks.length <= 3, `expected at most 3 ts/tsx blocks, found ${tsBlocks.length}`);
  for (const [i, block] of tsBlocks.entries()) {
    assert.ok(block.lines.length <= 20, `ts/tsx block #${i + 1} has ${block.lines.length} lines, expected <= 20`);
  }
});

/* ---------------------------------------------------------------------- *
 * R2 — every name README's `readme:api` anchor claims is real: exported
 * either from the root entry (surfaceOf(dist)) or from the two named
 * subpath entries, `@ecosy/next/inject` and `@ecosy/next/jwt`.
 * ---------------------------------------------------------------------- */

const DECL_RE = /^export\s+(?:declare\s+)?(?:interface|type|enum|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

/** Every name a single `.d.ts` file itself exports — same declaration
 *  shapes `surfaceOf` recognizes, applied to one file instead of a chain
 *  of `export * from` modules. Used for the two subpath entries, which
 *  are never re-exported from the root and so are invisible to
 *  `surfaceOf(dist)`. */
function namesInDts(path) {
  const content = readFileSync(path, "utf8");
  const names = new Set();
  let m;
  while ((m = DECL_RE.exec(content))) names.add(m[1]);
  return names;
}

test("R2: every name in the readme:api anchor is exported from the root entry or a named subpath", () => {
  const apiText = anchorBlock(readme, "api");
  const names = backtickNames(apiText);
  assert.ok(names.length >= 8, `expected at least 8 names in the readme:api anchor, found ${names.length}`);

  const surface = surfaceOf(distDir);
  const injectNames = namesInDts(join(distDir, "inject.d.ts"));
  const jwtNames = namesInDts(join(distDir, "jwt.d.ts"));

  const missing = names.filter((n) => !surface.names.has(n) && !injectNames.has(n) && !jwtNames.has(n));
  assert.deepEqual(missing, [], `README's readme:api anchor claims these names but none of dist/index.d.ts, dist/inject.d.ts, dist/jwt.d.ts export them: ${missing.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * R3 — every `@ecosy/next...` import specifier in ANY code block (not
 * just `ts`) must be a key that is really open in package.json's
 * `exports` — set membership, never `.startsWith`. This is the one thing
 * that would catch `@ecosy/next/csrf` or `@ecosy/next/cookie-jar`: both
 * are real modules under dist/, so they LOOK like they should work, and
 * `exports` simply does not open them.
 * ---------------------------------------------------------------------- */

test("R3: every @ecosy/next import specifier in every code block is a real key in package.json's exports", () => {
  const allSpecifiers = codeBlocks(readme).flatMap((b) => importSpecifiers(b.lines.join("\n")));
  const ownSpecifiers = allSpecifiers.filter((s) => s === pkg.name || s.startsWith(`${pkg.name}/`));
  assert.ok(ownSpecifiers.length >= 3, `expected at least 3 @ecosy/next import specifiers across README's code blocks, found ${ownSpecifiers.length}`);

  const exportKeys = new Set(Object.keys(pkg.exports ?? {}));
  const bad = ownSpecifiers.filter((s) => !exportKeys.has(exportsKeyFor(s, pkg.name)));
  assert.deepEqual(bad, [], `these import specifiers are not open in package.json's "exports": ${bad.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * R4 / R4b — every `ts`/`tsx` block must actually compile under this
 * repo's own `tsc`, `--strict`, against the dist/ that is about to be
 * published. `--listFiles` is the guard against a tsconfig that silently
 * compiles zero files and reports exit 0 for having checked nothing
 * (house-rules: a BUILD-FAILED-shaped hole disguised as KILLED). R4b
 * closes the parallel hole: an example placed in a `js` block would never
 * reach `tsc` at all.
 * ---------------------------------------------------------------------- */

test("R4: every ts/tsx code block in README compiles with this repo's tsc --strict", () => {
  const tsBlocks = codeBlocks(readme).filter((b) => b.lang === "ts" || b.lang === "tsx");
  assert.ok(tsBlocks.length >= 1, "expected at least one ts/tsx code block to check");

  const dir = mkdtempSync(join(tmpdir(), "ecosy-next-readme-"));
  const written = tsBlocks.map((b, i) => {
    const file = join(dir, `example-${i}.${b.lang}`);
    writeFileSync(file, b.lines.join("\n") + "\n");
    return file;
  });

  const tsconfigPath = join(dir, "tsconfig.json");
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          lib: ["dom", "dom.iterable", "esnext"],
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          esModuleInterop: true,
          jsx: "react-jsx",
          paths: {
            "@ecosy/next": [join(distDir, "index.d.ts")],
            "@ecosy/next/*": [join(distDir, "*.d.ts")],
          },
        },
        include: written,
      },
      null,
      2,
    ),
  );

  let output;
  let failed = false;
  try {
    output = execFileSync(tscBin, ["-p", tsconfigPath, "--listFiles"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    failed = true;
    output = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }

  // Chống rỗng: a tsconfig whose `include` resolves to nothing still exits
  // 0 and prints an empty file list — this asserts tsc actually looked at
  // every example file this test just wrote, not merely that it exited
  // clean.
  for (const file of written) {
    assert.ok(output.includes(file), `tsc --listFiles never listed ${file} — the tsconfig compiled nothing, not something clean`);
  }
  assert.ok(!failed, `README's ts/tsx examples fail to compile:\n${output}`);
});

test("R4b: no js/jsx/javascript code block in README mentions @ecosy/next", () => {
  const looseBlocks = codeBlocks(readme).filter((b) => ["js", "jsx", "javascript"].includes(b.lang));
  for (const [i, block] of looseBlocks.entries()) {
    assert.ok(!block.lines.join("\n").includes("@ecosy/next"), `js/jsx block #${i + 1} teaches @ecosy/next API outside R4's reach — use a ts block or fence it as text`);
  }
});

/* ---------------------------------------------------------------------- *
 * R5 — every `](#slug)` internal link must resolve to a real heading, via
 * GitHub's own slug rule, set membership rather than substring. A broken
 * heading anchor fails SILENTLY in a browser (no navigation, no error),
 * which is why this is worth a dedicated check even though today's
 * README has none.
 * ---------------------------------------------------------------------- */

test("R5: every internal link target matches a real heading slug", () => {
  const targets = internalLinkTargets(readme);
  const slugs = new Set(headings(readme).map(slugify));

  if (targets.length === 0) {
    // README has no `](#...)` links today — asserted here so this test
    // cannot pass merely because the extraction regex silently returns
    // nothing; it also fails if a link is added without this test being
    // revisited to drop the second assertion.
    assert.ok(!readme.includes("](#"), "no internal-link targets were extracted, but README contains \"](#\" — the extraction regex is broken");
    return;
  }

  const dangling = targets.filter((t) => !slugs.has(t));
  assert.deepEqual(dangling, [], `these internal links do not match any heading: ${dangling.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * R6 — every docs.ecosy.io URL in README (and package.json's homepage)
 * must resolve, live, to a real 200 page — not a soft-404. Opt-in: this
 * needs a network and is gated behind ECOSY_CHECK_LINKS=1 so a bad wifi
 * connection never turns this suite red.
 * ---------------------------------------------------------------------- */

function docsUrls() {
  const re = /https:\/\/docs\.ecosy\.io[^\s)]*/g;
  const found = new Set();
  let m;
  while ((m = re.exec(readme))) found.add(m[0]);
  if (typeof pkg.homepage === "string" && /^https:\/\/docs\.ecosy\.io/.test(pkg.homepage)) {
    found.add(pkg.homepage);
  }
  return [...found];
}

test("R6 setup: at least 2 docs.ecosy.io URLs are found, and every one is https", () => {
  const urls = docsUrls();
  assert.ok(urls.length >= 2, `expected at least 2 docs.ecosy.io URLs across README and package.json, found ${urls.length}`);
  for (const u of urls) assert.ok(u.startsWith("https://"), `${u} is not https`);
});

test("R6: every docs.ecosy.io URL in README resolves to a real 200 page, not a 404", { skip: process.env.ECOSY_CHECK_LINKS !== "1" && "set ECOSY_CHECK_LINKS=1 to run this network-dependent check" }, async () => {
  const urls = docsUrls();
  for (const url of urls) {
    const res = await fetch(url);
    assert.equal(res.status, 200, `${url} did not return 200 (got ${res.status})`);
    const body = await res.text();
    const titleMatch = /<title>([^<]*)<\/title>/.exec(body);
    const title = titleMatch ? titleMatch[1] : "";
    assert.notEqual(title, "404: This page could not be found.", `${url} returned 200 but its title says it is a 404 page (soft-404)`);
    if (url.includes("/next")) {
      assert.ok(title.includes("@ecosy/next"), `${url} is meant to be the package page but its title ("${title}") does not mention @ecosy/next`);
    }
  }
});

/* ---------------------------------------------------------------------- *
 * R7 — no inflated marketing language, anywhere in README (including
 * code blocks). Same banned list as tests/changelog.test.mjs's T6, so the
 * two guards do not drift apart.
 * ---------------------------------------------------------------------- */

test("R7: no banned marketing word appears anywhere in README.md", () => {
  const found = scanBanned(readme);
  assert.deepEqual(found, [], `banned word(s) found in README.md: ${found.join(", ")}`);
});

/* ---------------------------------------------------------------------- *
 * R8 — README.md must actually land in the npm tarball, under its exact
 * spelling. This is the SOLE guard for that spelling: `existsSync` cannot
 * tell "README.md" from "Readme.md" on a case-insensitive filesystem, and
 * npm packs either one under its own name regardless of what `files`
 * says (measured, task 0055 Planner, C6's fifth measurement) — see the
 * Kết quả section on A11 for the case-sensitivity measurement this test
 * exists to cover alone.
 * ---------------------------------------------------------------------- */

test("R8: npm pack --dry-run includes README.md, exact case", () => {
  const json = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const parsed = JSON.parse(json);
  const paths = parsed[0].files.map((f) => f.path);
  assert.ok(paths.includes("README.md"), `npm pack tarball does not include "README.md" (exact case) — found: ${paths.filter((p) => p.toLowerCase() === "readme.md").join(", ") || "nothing matching"}`);
});

/* ---------------------------------------------------------------------- *
 * R9 — package.json's `homepage` and README's own documentation link must
 * name the same URL, exactly, and it must be the package's own page (not
 * merely a live docs.ecosy.io URL that happens to point elsewhere).
 * ---------------------------------------------------------------------- */

test("R9: package.json's homepage exactly matches a URL README lists, and it is the package page", () => {
  assert.equal(typeof pkg.homepage, "string", "package.json has no homepage field");
  const urls = docsUrls();
  assert.ok(urls.includes(pkg.homepage), `package.json's homepage ("${pkg.homepage}") is not among the docs.ecosy.io URLs README lists`);
  assert.ok(pkg.homepage.includes("/next"), `package.json's homepage ("${pkg.homepage}") does not point at the package's own docs page`);
});

/* ---------------------------------------------------------------------- *
 * Self-check, same technique `tests/changelog.test.mjs` uses on itself:
 * several of R2-R9's checks could be quietly weakened (a `.startsWith`
 * standing in for set membership, a chống-rỗng assertion deleted, an
 * exit-code check dropped) in a way that leaves every assertion above
 * green on TODAY's data, because today's data is, correctly, clean. Real
 * README/package.json content alone cannot catch that class of weakening;
 * only reading this file's OWN source can. Placed last, and it excludes
 * its own body from the scan (cutting the source at its own start
 * marker), so none of the snippets below can be satisfied by this test
 * quoting itself. Every line above this marker is fair game. */
test("this file's own R2/R3/R4/R5/R6/R7/R8/R9 checks are still the real ones, not a tautology standing in for them", () => {
  const fullSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const ownTestMarker = "this file's own R2/R3/R4/R5/R6/R7/R8/R9 checks are still the real ones";
  const markerIndex = fullSource.lastIndexOf(ownTestMarker);
  assert.ok(markerIndex > 0, "internal: this test could not find its own start marker");
  const src = fullSource.slice(0, markerIndex);

  // R2 — the real "every name is exported somewhere" check, and its
  // chống-rỗng floor, must both still be present, unmodified.
  assert.equal(
    countOccurrences(src, "assert.deepEqual(missing, [], `README's readme:api anchor claims"),
    1,
    "R2's real check (every readme:api name resolves to a real export) must appear exactly once, unmodified — not replaced by a tautology",
  );
  assert.ok(src.includes("names.length >= 8"), "R2 must keep its chống-rỗng floor: at least 8 names extracted from readme:api");
  assert.ok(src.includes("backtickNames(apiText)"), "R2 must still extract names via backtickNames, not a hardcoded list");

  // R3 — set membership against package.json's exports keys, not a prefix
  // check (a prefix check would let `@ecosy/next/csrf` and
  // `@ecosy/next/cookie-jar` both through, exactly the two paths this
  // check exists to block).
  assert.ok(
    src.includes("exportKeys.has(exportsKeyFor(s, pkg.name))"),
    "R3 must check each specifier's mapped exports key by SET MEMBERSHIP, not `.startsWith`",
  );

  // R4 — the exit-code assertion, `strict: true` in the temp tsconfig, and
  // the --listFiles chống-rỗng loop must all still be present.
  assert.ok(src.includes("assert.ok(!failed,"), "R4 must assert the tsc run did not fail — running tsc without checking its exit code observes nothing");
  assert.ok(/strict:\s*true,/.test(src), "R4's temporary tsconfig must keep `strict: true` — without it, TS2353 (excess property) never fires, and a session/identity typo silently type-checks");
  assert.ok(src.includes("output.includes(file)"), "R4 must keep its --listFiles chống-rỗng loop — otherwise a misconfigured `include` compiling zero files still exits 0");

  // R5 — set membership against real heading slugs, not `.includes`.
  assert.ok(src.includes("!slugs.has(t)"), "R5 must check a link target by SET MEMBERSHIP against real heading slugs, not `.includes`");
  assert.ok(src.includes('!readme.includes("](#")'), "R5 must keep its chống-rỗng self-check for when there are zero internal links");
  assert.ok(
    src.includes("const targets = internalLinkTargets(readme);"),
    "R5 must extract targets by REALLY calling internalLinkTargets(readme), not a hardcoded []  — today's README happens to have zero links, so a hardcoded [] would otherwise be unobservable",
  );

  // R6 — the soft-404 title check must survive alongside the status check.
  assert.ok(
    src.includes('assert.notEqual(title, "404: This page could not be found."'),
    "R6 must keep comparing the fetched page's <title> against the known soft-404 title, not only its HTTP status",
  );

  // R7 — must scan the WHOLE readme, not a slice of it.
  assert.equal(countOccurrences(src, "const found = scanBanned(readme);"), 1, "R7 must call scanBanned on the full readme text, not a truncated slice");

  // R8 — the real tarball-contents check, reading npm's own answer.
  assert.ok(src.includes('paths.includes("README.md")'), "R8 must check npm pack's OWN reported file list for the exact string \"README.md\", not a tautology");

  // R9 — exact membership (Array#includes is SameValueZero, i.e. `===`
  // semantics), not `.startsWith`.
  assert.ok(src.includes("urls.includes(pkg.homepage)"), "R9 must compare package.json's homepage against README's URLs by EXACT match, not `.startsWith`");

  // C7 — surfaceOf must come from the shared module, not a re-implemented
  // local copy that could silently drift (and, per the task's own B16/B15
  // wording, could start walking dist/container.d.ts, dist/request-id.d.ts
  // or dist/request-store.d.ts, which must never be part of the public
  // surface).
  assert.ok(src.includes('import { surfaceOf } from "./support/surface.mjs"'), "this file must import surfaceOf from the shared module, not define its own copy");
  assert.ok(!src.includes("function surfaceOf("), "this file must not define a local surfaceOf — it would be the second copy C7 exists to prevent");
});

/** How many times `needle` occurs in `haystack`, non-overlapping — same
 *  helper `tests/changelog.test.mjs` uses for its own self-check. */
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
