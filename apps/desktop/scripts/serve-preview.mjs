/**
 * Serve `dist/` so `preview.html` opens in a plain browser tab (README §3.5).
 *
 * Twelve lines of `node:http` rather than a dev server: the panel is plain ES modules and static
 * files, so what it needs from a server is a MIME type and nothing else. A dev server here would be
 * a second build path, and the point of the preview is that it renders exactly what the shell loads.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT ?? 1421);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const wanted = url.pathname === "/" ? "/preview.html" : url.pathname;
    // Resolved inside dist, then checked: a normalised path can still climb out, and the
    // prefix test is the part that actually refuses it.
    const file = path.resolve(dist, "." + path.posix.normalize(wanted));
    if (!file.startsWith(dist)) {
      response.writeHead(403).end("outside dist");
      return;
    }
    try {
      await stat(file);
    } catch {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`the panel's modules: http://127.0.0.1:${port}/preview.html`);
  });
