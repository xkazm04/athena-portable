/**
 * The shell's tool registrations, captured as the objects the page hands the kit - not read as text.
 *
 * `components/shell/HostCapabilities.tsx` is rendered as the app ships it (its JSX transpiled by the
 * TypeScript this app already depends on, the `examples/demo-kit/test/ui-webmcp.test.ts` precedent),
 * with stand-ins in front of exactly what it imports from outside the app:
 *
 *   - `@athena/demo-kit/webmcp`'s `useWebMCPTool` records each spec, handler included;
 *   - `@athena/demo-kit/ui`'s `useToast` records what a handler toasts;
 *   - `next/navigation`'s `useRouter` / `useSearchParams` record pushes and serve one segment;
 *   - `next/cache`'s `revalidatePath`, imported by `app/actions.ts`, records the refresh.
 *
 * Every other import is the real module, so a captured handler calls the real server action, which
 * calls the real library, against whatever database the importing test file has scoped with
 * `tempHome` (import this module AFTER that call). `export`'s handler builds an anchor and clicks
 * it; the `document` given here answers the click by calling the real `app/api/export` GET, the
 * request a browser would make, so the provenance row it writes is the row the app writes.
 *
 * Stand-ins are matched by importer, so nothing but HostCapabilities.tsx and app/actions.ts sees one, and
 * `test/register.mjs` and every other test file are unchanged.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { WebMCPToolSpec } from "@athena/demo-kit/webmcp";
import type { DefectCounts } from "../../lib/types";

const here = (path: string): string => new URL(`../../${path}`, import.meta.url).href;
const moduleOf = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

const KEY = "tidycrm.test.captureTools";
const recorder = `globalThis[Symbol.for(${JSON.stringify(KEY)})]`;

/** One anchor click the export handler made, and what the route answered it with. */
export interface Download {
  href: string;
  download: string;
  status: number;
  body: Promise<string>;
}

/** Everything a render and the handler calls after it reached outside the app. */
export interface Recorder {
  specs: WebMCPToolSpec[];
  toasts: [tone: string, text: string][];
  pushes: string[];
  revalidated: string[];
  downloads: Download[];
  segment: string;
}

const rec: Recorder = { specs: [], toasts: [], pushes: [], revalidated: [], downloads: [], segment: "all" };
(globalThis as Record<symbol, unknown>)[Symbol.for(KEY)] = rec;

const SHELL = here("components/shell/");
const HOST = here("components/shell/HostCapabilities.tsx");
const STAND_INS: [scope: string, specifier: string, url: string][] = [
  [HOST, "@athena/demo-kit/webmcp", moduleOf(`export const useWebMCPTool = (spec) => { ${recorder}.specs.push(spec); };`)],
  [
    HOST,
    "@athena/demo-kit/ui",
    moduleOf(`export const useToast = () => ({ toast: (text, tone) => { ${recorder}.toasts.push([tone, text]); } });`),
  ],
  [
    HOST,
    "next/navigation",
    moduleOf(
      [
        `export const useRouter = () => ({ push: (path) => { ${recorder}.pushes.push(path); } });`,
        `export const useSearchParams = () => new URLSearchParams({ segment: ${recorder}.segment });`,
      ].join("\n"),
    ),
  ],
  [here("app/actions.ts"), "next/cache", moduleOf(`export const revalidatePath = (path) => { ${recorder}.revalidated.push(path); };`)],
];

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? "";
    const hit = STAND_INS.find(([scope, spec]) => spec === specifier && parent.startsWith(scope));
    if (hit) return { url: hit[2], shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!(url.startsWith(SHELL) && url.endsWith(".tsx"))) return next(url, context);
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

/** Only the members the export handler touches: `createElement("a")`, `href`, `download`, `click()`. */
function installDocument(get: (request: Request) => Response): void {
  const doc = {
    createElement(tag: string) {
      if (tag !== "a") throw new Error(`capture-tools: the export stand-in only builds anchors, not <${tag}>`);
      const anchor = {
        href: "",
        download: "",
        click() {
          const response = get(new Request(new URL(anchor.href, "http://tidycrm.test")));
          rec.downloads.push({ href: anchor.href, download: anchor.download, status: response.status, body: response.text() });
        },
      };
      return anchor;
    },
  };
  (globalThis as { document?: unknown }).document = doc;
}

/**
 * Render `HostCapabilities` once and return its registrations, in registration order.
 *
 * Each call clears the recorder and renders afresh, so a caller holds one consistent set; the
 * handlers close over the stand-ins above and over the real actions.
 */
export async function captureTools(counts?: DefectCounts, segment = "all"): Promise<Recorder> {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { GET } = await import("../../app/api/export/route");
  const { defectCounts } = await import("../../lib/db");
  const { HostCapabilities } = await import("../../components/shell/HostCapabilities");

  rec.specs = [];
  rec.toasts = [];
  rec.pushes = [];
  rec.revalidated = [];
  rec.downloads = [];
  rec.segment = segment;
  installDocument(GET);
  renderToStaticMarkup(createElement(HostCapabilities, { counts: counts ?? defectCounts() }));
  return rec;
}

/** One handler call the way the kit's door makes it: the arguments, and a context with a live signal. */
export async function call(spec: WebMCPToolSpec, args: Record<string, unknown>): Promise<unknown> {
  return await spec.handler(args, { signal: new AbortController().signal } as Parameters<WebMCPToolSpec["handler"]>[1]);
}
