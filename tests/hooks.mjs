/* `server-only` throws unless loaded under React's server condition, which only
   Next's own bundler sets. Outside Next it is swapped for an empty module. */
import { registerHooks } from "node:module";

const empty = new URL("./empty.cjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: empty, format: "commonjs", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
