/**
 * Module resolution for `node --test`, so the server-side library can be exercised
 * without a Next build.
 *
 * Next resolves four things this app's source relies on that bare Node does not:
 * the `server-only` build marker, extensionless relative imports, the `@/*`
 * path alias, and `.tsx`. This hook supplies all four and nothing else - the code
 * under test is the same source the app ships.
 *
 * WHY `.tsx` IS HERE (round 3), and it is a KIT GAP rather than a preference.
 * Node cannot strip types from JSX at all - `--experimental-transform-types` is
 * documented as not supporting it - so a `.tsx` file anywhere in an import chain
 * dies, first with ERR_UNKNOWN_FILE_EXTENSION and then, once the format is
 * supplied, with ERR_INVALID_TYPESCRIPT_SYNTAX. That never happened until the
 * camera round, when `@athena/demo-kit/zoom` began exporting a COMPONENT
 * (`Echo.tsx`) from its barrel: every app whose tests touch anything in that
 * barrel - which is every app that has a level - stopped running, tidycrm
 * included, and none of them uses `Echo`.
 *
 * So a demo-kit `.tsx` is replaced, under the test runner only, by a module that
 * declares the same VALUE exports and nothing else, which is enough for the
 * barrel to re-export them and for nothing under test to notice. The fix belongs
 * in the kit: keep the barrel `.ts` and put components behind their own entry
 * point (`@athena/demo-kit/zoom/ui`), the way `@athena/demo-kit/activity/ui`
 * already is.
 *
 *   node --import ./test/register.mjs --test test/
 */
import { readFileSync } from "node:fs";
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
  load(url, context, next) {
    if (!url.endsWith(".tsx") || !url.includes("/demo-kit/")) return next(url, context);
    const source = readFileSync(new URL(url), "utf8");
    const names = new Set();
    for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(m[1]);
    }
    const shim = [...names].map((n) => `export const ${n} = undefined;`).join(" ");
    return { format: "module", shortCircuit: true, source: shim || "export {};" };
  },
});
