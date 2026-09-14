/**
 * Module resolution for `node --test`, so the server actions can be exercised without a Next build.
 *
 * Copied in shape from `examples/tidycrm/test/register.mjs` - the sibling app that already had one.
 * Next resolves four things this app's source relies on that bare Node does not: the `server-only`
 * build marker, `next/cache`'s request-scoped revalidation, extensionless relative imports, and the
 * `@/*` path alias. This hook supplies those and nothing else - the code under test is the same
 * source the app ships.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import { registerHooks } from "node:module";

const ROOT = new URL("../", import.meta.url).href;
const SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** `revalidatePath` needs a request store. Nothing here renders, so the calls are recorded and dropped. */
const CACHE_STUB = "data:text/javascript,export function revalidatePath(){};export function revalidateTag(){}";

registerHooks({
  resolve(specifier, context, next) {
    // A build-time marker in Next; under the test runner every module is server-side already.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    if (specifier === "next/cache") {
      return { url: CACHE_STUB, shortCircuit: true };
    }
    const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), ROOT).href : specifier;
    try {
      return next(spec, context);
    } catch (err) {
      // A bare directory is `<dir>/index.ts` to a bundler and an error to Node, which reports it
      // as its own code rather than as a missing module.
      const recoverable =
        err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "ERR_UNSUPPORTED_DIR_IMPORT";
      if (!recoverable) throw err;
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
