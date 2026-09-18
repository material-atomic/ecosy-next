/* 0030: `895a9e6` deleted the whole `Instrument` module because it guessed at
   Next's runtime (`process.env.NEXT_RUNTIME`) — "sai scope với Next" — but left
   one trace behind: the `@example` in `Bootstrap`'s own docblock still told a
   reader to call `Instrument.nodejs(...)`, an API that no longer exists. Because
   `tsconfig.json` has `declaration: true`, that docblock is compiled straight
   into `dist/bootstrap.d.ts` and is exactly what a user's editor shows on hover
   — so the stale example was not cosmetic, it was the only documented way to
   wire this package into `instrumentation.ts`, and it was wrong.

   Measured before writing a single line here (see Kết quả for the exact repro):
   with the docblock sitting where it used to — directly above the UNEXPORTED
   `const BootstrapImpl = function ...`, not above `export const Bootstrap =
   BootstrapImpl` — tsc's declaration emitter drops it entirely. Rebuilding
   `main` as-is (before this task's edit) produces a `dist/bootstrap.d.ts` with
   NO `@example` at all, old text or new. Fixing only the wording would have
   left the fix invisible to any editor. So the docblock was relocated (content
   unchanged beyond the `@example` itself) to sit directly above `export const
   Bootstrap = BootstrapImpl;`, the declaration whose type actually reaches
   `dist/`. §3 below reads the built file, not the source, so it fails the same
   way a careless "it compiles, ship it" would have.

   Bootstrap itself has never had a test before this file — the eight-mutation
   floor task 0030 sets exists because nobody has asked "is this class correct"
   until now, not because this task changes its behaviour. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Bootstrap } = require("../dist/index.js");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");

/** Every file under `dir`, recursively — same helper as `no-core-dep.test.mjs`,
 *  so `dist/utils/` is never silently skipped. */
function allFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* 1. The example in the docblock is not decoration — it is code, and it   */
/*    must actually run: steps in order, the final fn after all of them,   */
/*    Bootstrap.get() reading what a step returned, and register() being   */
/*    callable twice without throwing (a hot reload calls it again).       */
/* ---------------------------------------------------------------------- */

test("the @example shape — two .register() steps then .start(fn), called from a register() like instrumentation.ts's — runs the steps in registration order, runs fn strictly after both, and makes both results readable via Bootstrap.get", async () => {
  const order = [];

  // "first" resolves after a delay on purpose: if execute() ever stopped
  // awaiting each step before moving to the next (task mutation 1) or ran
  // this.fns in reverse (mutation 2), "second" — which resolves immediately —
  // would land in `order` before "first" does.
  const bootstrap = Bootstrap({})
    .register("db", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("db");
      return { name: "db" };
    })
    .register("schedule", async () => {
      order.push("schedule");
      return { name: "schedule" };
    })
    .start(async () => {
      order.push("final");
    });

  // instrumentation.ts
  async function register() {
    await bootstrap.init();
  }

  await register();

  assert.deepEqual(
    order,
    ["db", "schedule", "final"],
    "steps must run in the order they were registered, and the start() fn must run strictly after both — not before (mutation 3) and not skipped (mutation 4)",
  );
  assert.deepEqual(Bootstrap.get("db"), { name: "db" }, "Bootstrap.get must read back exactly what the \"db\" step returned (mutation 6: set() never writing)");
  assert.deepEqual(Bootstrap.get("schedule"), { name: "schedule" }, "same, for the second step");

  // A hot reload in Next calls the module's register() again; it must not throw.
  await assert.doesNotReject(() => register(), "calling register() a second time — exactly what a hot reload does — must not throw");
});

/* ---------------------------------------------------------------------- */
/* 2. push()/register() must return a NEW builder and leave the receiver   */
/*    unchanged (task mutation 7) — the one claim the test above can't see */
/*    because it never branches from the same builder twice.               */
/* ---------------------------------------------------------------------- */

test("push() never mutates the builder it was called on — two branches built from the SAME base each keep only their own step, and the base itself gains none", async () => {
  const seenA = [];
  const seenB = [];

  const base = Bootstrap({});
  const branchA = base.push(async () => {
    seenA.push("a");
  });
  const branchB = base.push(async () => {
    seenB.push("b");
  });

  await branchB.start().init();

  assert.deepEqual(seenB, ["b"], "branchB must run only its own step");
  assert.deepEqual(
    seenA,
    [],
    "branchA's step must never run just because branchB was built from the same base afterwards — if push() mutated this.fns in place and returned `this`, branchA and branchB would be the same object and both steps would run together",
  );

  await base.start().init();
  assert.deepEqual(seenA, [], "the base builder itself must still have zero steps — it was never supposed to have gained either branch's step");
});

/* Task mutation 5 — register() dropping `if (result !== undefined)` so it
   also stores an explicit `undefined` — has no public-API test here on
   purpose, not by oversight. Bootstrap.get(key) is `map.get(key) as T |
   undefined`, and a JS Map returns `undefined` from .get() both when a key
   was never set AND when it was set to `undefined` explicitly; there is no
   `has()` on BootstrapFactory to tell the two apart. Measured, not assumed:
   running that mutant against every test in this file, including both above,
   leaves the whole suite green — the same result a correct build gives. This
   mutant is recorded here rather than test-covered because there is nothing
   for a test to observe through the surface this package actually exports. */

/* ---------------------------------------------------------------------- */
/* 3. Public surface NEVER mentions `Instrument` again — two tiers, since   */
/*    they fail in two different ways.                                     */
/* ---------------------------------------------------------------------- */

test('the built package never exports anything named "Instrument"', () => {
  const dist = require("../dist/index.js");
  assert.equal("Instrument" in dist, false, 'the removed class must not resurface as an export — "Instrument" in dist/index.js exports must be false');
});

test('no file under dist/ contains the literal, capitalised string "Instrument" — this is the tier that catches a docblock, which the exports check above cannot see', () => {
  const offenders = [];
  for (const file of allFiles(distDir)) {
    const content = readFileSync(file, "utf8");
    if (content.includes("Instrument")) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `capitalised "Instrument" found in compiled output (this must NOT flag lowercase "instrumentation.ts", a legitimate Next convention this task leaves untouched): ${offenders.join(", ")}`,
  );
});

/* ---------------------------------------------------------------------- */
/* 4. The corrected example is not just absent of the old API — it is      */
/*    actually PRESENT, verbatim, in the .d.ts a user's editor reads.      */
/*    Without this, "fixing the wording" and "fixing nothing because the   */
/*    docblock never reached dist/ in the first place" look identical.     */
/* ---------------------------------------------------------------------- */

test("dist/bootstrap.d.ts contains the new, runnable @example verbatim — the whole reason the docblock was relocated onto the exported `Bootstrap` declaration", () => {
  const declaration = readFileSync(join(distDir, "bootstrap.d.ts"), "utf8");
  assert.ok(declaration.includes("@example"), "the docblock's @example tag must reach dist/bootstrap.d.ts at all");
  assert.ok(
    declaration.includes("export async function register() {"),
    "the new instrumentation.ts-shaped example must be present verbatim in the compiled declaration, not just in src/",
  );
  assert.ok(declaration.includes("await bootstrap.init();"), "the example's body — the actual call a reader is meant to copy — must be present too");
});
