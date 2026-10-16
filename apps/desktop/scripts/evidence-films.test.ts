/**
 * The dev server's film route — README section 3.1, ADR 0055.
 *
 * The Playbooks module plays a playbook's film from the repository's `evidence/` through
 * `vite.config.ts`'s `athena-evidence-films` middleware, which answers byte ranges so a `<video>`
 * can seek. The middleware is driven here as the dev server would, with the file system faked: a
 * test may not write into the repository's `evidence/`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

const SIZE = 1000;

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    statSync: (file: string) => {
      if (String(file).replaceAll("\\", "/").endsWith("evidence/demo/film.mp4")) return { size: SIZE };
      return real.statSync(file);
    },
    createReadStream: (_file: string, opts: { start: number; end: number }) => ({
      pipe: (res: Reply) => res.end(`${opts.start}-${opts.end}`),
    }),
  };
});

type Reply = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(k: string, v: string): void;
  end(body?: string): void;
};

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

async function filmRoute(): Promise<Handler> {
  const config = (await import("../vite.config")).default as { plugins: unknown[] };
  const plugin = config.plugins.flat().find(
    (p): p is { name: string; configureServer: (s: unknown) => void } =>
      typeof p === "object" && p !== null && (p as { name?: string }).name === "athena-evidence-films",
  );
  if (!plugin) throw new Error("the film route plugin is gone");
  let handler: Handler | null = null;
  plugin.configureServer({ middlewares: { use: (_path: string, h: Handler) => (handler = h) } });
  if (!handler) throw new Error("the film route registered no middleware");
  return handler;
}

async function get(range?: string): Promise<Reply> {
  const route = await filmRoute();
  const res: Reply = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(body = "") {
      this.body = body;
    },
  };
  const req = { url: "/demo/film.mp4", headers: range ? { range } : {} } as unknown as IncomingMessage;
  route(req, res as unknown as ServerResponse, () => {
    throw new Error("the route passed a film request on");
  });
  return res;
}

describe("the film route's byte ranges", () => {
  it("sends the whole file with no Range", async () => {
    const r = await get();
    expect([r.statusCode, r.body, r.headers["content-length"]]).toEqual([200, "0-999", "1000"]);
    expect(r.headers["content-range"]).toBeUndefined();
  });

  it("sends a closed and an open range", async () => {
    const closed = await get("bytes=100-199");
    expect([closed.statusCode, closed.body, closed.headers["content-range"]]).toEqual([206, "100-199", "bytes 100-199/1000"]);
    const open = await get("bytes=900-");
    expect([open.statusCode, open.body, open.headers["content-length"]]).toEqual([206, "900-999", "100"]);
  });

  it("sends the last n bytes for a suffix range, not the first n", async () => {
    const r = await get("bytes=-100");
    expect([r.statusCode, r.body, r.headers["content-range"]]).toEqual([206, "900-999", "bytes 900-999/1000"]);
    const all = await get("bytes=-5000");
    expect([all.statusCode, all.body]).toEqual([206, "0-999"]);
  });

  it("refuses a range the file cannot satisfy", async () => {
    for (const range of ["bytes=1000-", "bytes=-0", "bytes=500-100"]) {
      const r = await get(range);
      expect([r.statusCode, r.headers["content-range"]], range).toEqual([416, "bytes */1000"]);
    }
  });
});
