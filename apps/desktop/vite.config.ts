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
 * (ADR 0055), so the Playbooks module can play it; a build carries no media and the module shows
 * the committed thumbnail instead.
 */
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.resolve(root, "../../evidence");

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
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
        const start = range && range[1] ? Number(range[1]) : 0;
        const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end || start >= size) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          res.end();
          return;
        }
        res.statusCode = range ? 206 : 200;
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(end - start + 1));
        if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        createReadStream(file, { start, end }).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), evidenceFilms()],
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src-tauri/src/*.test.ts"],
  },
});
