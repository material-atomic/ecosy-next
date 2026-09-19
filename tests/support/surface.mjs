/* Task 0055, C7: `surfaceOf` used to live only inside `changelog.test.mjs`
   (task 0027). `tests/readme.test.mjs` needs the exact same reader — the
   one that walks `dist/index.d.ts`'s `export * from` lines, then every
   declaration each of those `.d.ts` files itself `export`s — so this file
   pulls it out to a single source instead of growing a second copy that
   could drift from the first (house-rules, "Không có tầng chung cũng là
   một PHÉP ĐO": patching at the gap is the next copy).

   Moved verbatim, no logic changed. `changelog.test.mjs` now imports this
   instead of defining its own `surfaceOf`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read the public surface of a built package: every name any root-entry
 *  module actually `export`s. Walks `dist/index.d.ts`'s `export * from`
 *  lines, then every declaration each of those `.d.ts` files itself
 *  `export`s — `container.d.ts`, `request-id.d.ts`, `request-store.d.ts`
 *  live in `dist/` but are never re-exported from the root, so they must
 *  never be walked here. */
export function surfaceOf(dir) {
  const indexDts = readFileSync(join(dir, "index.d.ts"), "utf8");
  const moduleRe = /^export \* from ["']\.\/([^"']+)["'];?\s*$/gm;
  const modules = [];
  let mm;
  while ((mm = moduleRe.exec(indexDts))) modules.push(mm[1]);

  const declRe = /^export\s+(?:declare\s+)?(?:interface|type|enum|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  const names = new Set();
  for (const mod of modules) {
    const content = readFileSync(join(dir, `${mod}.d.ts`), "utf8");
    let dm;
    while ((dm = declRe.exec(content))) names.add(dm[1]);
  }
  return { modules, names };
}
