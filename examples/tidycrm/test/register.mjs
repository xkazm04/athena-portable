/**
 * Module resolution for `node --test`, so the server-side library can be exercised
 * without a Next build.
 *
 * Next resolves three things this app's source relies on that bare Node does not:
 * the `server-only` build marker, extensionless relative imports, and the `@/*`
 * path alias. This hook supplies all three and nothing else - the code under test
 * is the same source the app ships.
 *
 *   node --import ./test/register.mjs --test test/
 */
import { registerHooks } from "node:module";

const ROOT = new URL("../", import.meta.url).href;
const SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

registerHooks({
  resolve(specifier, context, next) {
    // A build-time marker in Next; under the test runner every module is server-side already.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
    try {
      return next(spec, context);
    } catch (err) {
      // A miss is "no such file"; a bare directory (`@/components/blocks/model`) is "unsupported".
      if (err?.code !== "ERR_MODULE_NOT_FOUND" && err?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") {
        throw err;
      }
      for (const suffix of SUFFIXES) {
        try {
          return next(spec + suffix, context);
        } catch {
          /* try the next suffix */
        }
      }
      throw err;
    }
  },
});
