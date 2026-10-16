/**
 * Module resolution for `node --test`, so the books can be exercised without a Next build.
 *
 * Copied in shape from `examples/hirelane/test/register.mjs` and `examples/tidycrm/test/register.mjs`
 * - the sibling apps that already had one. Next resolves four things this app's source relies on
 * that bare Node does not: the `server-only` build marker, `next/cache`'s request-scoped
 * revalidation, extensionless relative imports, and the `@/*` path alias. This hook supplies those
 * and nothing else - the code under test is the same source the app ships.
 *
 * Two more, for the tool layer (`test/tool-handlers.test.ts`):
 *
 * - A `.tsx` file that renders nothing - the two registration files under
 *   `components/lanes/tools/` return `null` and hold no JSX - is loaded with its types stripped,
 *   as a `.ts` file is. Node has no `.tsx` loader of its own; a file that does hold JSX still
 *   fails to load, loudly.
 * - A test may put STAND-INS in front of the modules those files import (React, the router, the
 *   toast, the kit's registration hook, the server actions), so each handler can be driven and
 *   what it reaches recorded. They apply only to imports made from inside `scope`; every other
 *   importer, the stand-ins themselves included, gets the real module.
 *
 *   node --import ./test/register.mjs --test "test/**\/*.test.ts"
 */
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";

const ROOT = new URL("../", import.meta.url).href;
const SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** `revalidatePath` needs a request store. Nothing here renders, so the calls are dropped. */
const CACHE_STUB = "data:text/javascript,export function revalidatePath(){};export function revalidateTag(){}";

/**
 * `{ scope: <URL prefix>, modules: { <specifier>: <URL> } }`, set by a test before it imports the
 * files under `scope`. Read at resolve time, so a test file that never sets it sees no change. A
 * registered symbol rather than an export, because importing this file a second time would
 * register the hooks twice.
 */
const STAND_INS = Symbol.for("ledgerbox.test.standIns");

function standIn(specifier, parentURL) {
  const stand = globalThis[STAND_INS];
  if (!stand || !parentURL || !parentURL.startsWith(stand.scope)) return undefined;
  return Object.hasOwn(stand.modules, specifier) ? stand.modules[specifier] : undefined;
}

registerHooks({
  resolve(specifier, context, next) {
    // A build-time marker in Next; under the test runner every module is server-side already.
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    if (specifier === "next/cache") {
      return { url: CACHE_STUB, shortCircuit: true };
    }
    const stood = standIn(specifier, context.parentURL);
    if (stood) return { url: stood, shortCircuit: true };
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
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".tsx")) {
      const source = stripTypeScriptTypes(readFileSync(new URL(url), "utf8"));
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
