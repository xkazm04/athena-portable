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

/**
 * The one `.tsx` on the kit's zoom barrel, stubbed.
 *
 * Node 24 strips types out of a `.ts` and refuses a `.tsx` outright, so from the
 * round-3 camera landing onward `import … from "@athena/demo-kit/zoom"` — which
 * every test of this direction's clock does — died on `zoom/Echo.tsx` before it
 * reached the pure module it wanted. The barrel is the kit's and is not this
 * app's to split; a test runner that renders nothing does not need the component.
 *
 * So the ECHO CONTAINER, and only it, resolves to a stub. Everything the tests
 * actually assert against — `parseMs`, `parseBezier`, `secs`, the pose and field
 * arithmetic — is `.ts` and is the real thing. `ECHO_GRACE_MS` keeps its value
 * because it is a number a test may one day want to read; `Echo` is a function
 * that throws, so a test that tried to RENDER it would fail loudly rather than
 * quietly pass against a stub.
 */
const ECHO_STUB =
  "data:text/javascript," +
  encodeURIComponent(
    "export const ECHO_GRACE_MS = 34;" +
      "export function Echo(){ throw new Error('zoom/Echo is stubbed under node --test'); }",
  );
const isKitEcho = (specifier, parentURL) =>
  (specifier === "./Echo" || specifier.endsWith("/Echo.tsx")) &&
  typeof parentURL === "string" &&
  parentURL.includes("demo-kit/src/zoom");

registerHooks({
  resolve(specifier, context, next) {
    // A build-time marker in Next; under the test runner every module is server-side already.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    if (specifier === "next/cache") {
      return { url: CACHE_STUB, shortCircuit: true };
    }
    if (isKitEcho(specifier, context?.parentURL)) {
      return { url: ECHO_STUB, shortCircuit: true };
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
