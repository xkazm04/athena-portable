/**
 * Serve `outside/` — the static site the journey uses for its tier-2 beats.
 *
 *   node examples/journey/scripts/serve-outside.mjs <dir> <port>
 *
 * `node:http` and thirty lines, because what a directory of hand-written HTML needs from a server
 * is a MIME type and nothing else. A dev server here would be a second thing that can fail in a
 * run whose whole point is that the page is inert.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 3005);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const wanted = url.pathname === "/" ? "/index.html" : url.pathname;
    // Resolved inside the root and then checked: a normalised path can still climb out, and the
    // prefix test is the part that refuses it.
    const file = path.resolve(root, "." + path.posix.normalize(wanted));
    if (!file.startsWith(root)) {
      response.writeHead(403).end("outside the site");
      return;
    }
    try {
      await stat(file);
    } catch {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      // The page is a fixture and every run should read the bytes on disk.
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(response);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`outside: ready on ${port} from ${root}`);
  });
