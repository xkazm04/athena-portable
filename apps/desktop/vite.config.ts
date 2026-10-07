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
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
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
