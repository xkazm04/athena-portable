/**
 * Four HTML entries (README section 3.1; ADR 0026 added the second window, ADR 0027 the halo).
 *
 * - `chrome.html` is the privileged shell document: the module bar and whichever module is
 *   selected. Tauri loads it into the `chrome` webview.
 * - `athena.html` is her own window (ADR 0026): a transparent, frameless webview with its own stores.
 * - `halo.html` is the edge glow and caption (ADR 0027): one plain-TS copy per monitor, in a
 *   transparent, click-through overlay.
 * - `preview.html` is the module preview harness. It runs in a plain browser with no Tauri, no
 *   IPC and no daemon, and the shell never loads it. It is an input here so `pnpm build`
 *   typechecks and bundles it like anything else — a harness that is not built is a harness that
 *   has already rotted.
 *
 * Port 1431 and `strictPort`, so a busy port fails loudly rather than silently moving and leaving
 * `devUrl` in `tauri.conf.json` pointing at nothing. 1431 rather than the 1420/1421 a Tauri app
 * defaults to, because a developer machine is expected to have the reference app's dev server on
 * one of those already — and two shells that fight over a port is a morning lost to a blank
 * window.
 *
 * The dev server also hands out a playbook's film from the repository's gitignored `evidence/`
 * (ADR 0055), so the Playbooks module can play it; a build carries no film and the topic page shows
 * the committed stills instead (ADR 0137).
 */
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
// @ts-expect-error a plain .mjs build helper, no declarations
import { devSourceLocPlugin } from "./scripts/dev-source-loc.mjs";
import { defineConfig } from "vitest/config";

// @ts-expect-error the config loader wants the extension; this tsconfig does not allow it (TS5097)
import { injectBoot } from "./src/appearance-boot.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.resolve(root, "../../evidence");

/**
 * The bytes a `Range` header asks of a file of `size` bytes (RFC 9110 section 14.1.2): `a-b`,
 * `a-` (to the end) and `-n` (the last n). A header that is not one single range is ignored and the
 * whole file is sent; a range the file cannot satisfy is 416.
 */
export function evidenceRange(
  header: string | undefined,
  size: number,
): { status: 200 | 206 | 416; start: number; end: number } {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return { status: 200, start: 0, end: size - 1 };
  const [start, end] =
    m[1] === ""
      ? [Math.max(0, size - Number(m[2])), Number(m[2]) === 0 ? -1 : size - 1]
      : [Number(m[1]), m[2] ? Math.min(Number(m[2]), size - 1) : size - 1];
  if (start > end || start >= size) return { status: 416, start, end };
  return { status: 206, start, end };
}

/**
 * `GET /evidence/<id>/<file>.mp4` from `evidence/`, with byte ranges so a `<video>` can seek. One
 * directory deep and one name pattern: nothing else under the repository is reachable this way.
 */
function evidenceFilms(): Plugin {
  return {
    name: "athena-evidence-films",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/evidence", (req, res, next) => {
        const m = /^\/([\w.-]+)\/([\w.-]+\.mp4)$/.exec((req.url ?? "").split("?")[0]);
        if (!m || m[1].startsWith(".")) return next();
        const file = path.join(EVIDENCE, m[1], m[2]);
        let size: number;
        try {
          size = statSync(file).size;
        } catch {
          res.statusCode = 404;
          res.end();
          return;
        }
        const { status, start, end } = evidenceRange(req.headers.range, size);
        if (status === 416) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          res.end();
          return;
        }
        res.statusCode = status;
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(end - start + 1));
        if (status === 206) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        createReadStream(file, { start, end }).pipe(res);
      });
    },
  };
}

/**
 * The appearance boot (ADR 0165): `chrome.html` and `athena.html` get `bootAppearance` inlined as
 * the first script in their head, so the person's theme, skin, text size and motion are on the
 * root before the first stylesheet paints. `pre`, so it runs before Vite adds its own tags.
 */
export function appearanceBoot(): Plugin {
  return {
    name: "athena-appearance-boot",
    transformIndexHtml: {
      order: "pre",
      handler: (html, ctx) => injectBoot(html, path.basename(ctx.filename)),
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [appearanceBoot(), devSourceLocPlugin(), react(), evidenceFilms()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  clearScreen: false,
  server: {
    port: 1431,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebView2 and WebKitGTK are both well past this; it is here so the bundle is not shipped
    // through a transform chain aimed at browsers the shell can never run in.
    target: "chrome110",
    sourcemap: false,
    rollupOptions: {
      input: {
        chrome: path.resolve(root, "chrome.html"),
        athena: path.resolve(root, "athena.html"),
        preview: path.resolve(root, "preview.html"),
        halo: path.resolve(root, "halo.html"),
      },
    },
  },
  test: {
    // Node, not jsdom: nearly every test here is pure logic or a `renderToStaticMarkup`, and a
    // DOM implementation nobody asked for is a dependency and a second set of quirks. The one
    // exception opts in with a `@vitest-environment jsdom` comment: `src-tauri/src/hands.test.ts`
    // drives the page-world hands script, which is a DOM and nothing else.
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src-tauri/src/*.test.ts",
      "scripts/*.test.ts",
    ],
  },
});
