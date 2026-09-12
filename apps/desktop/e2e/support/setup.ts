/**
 * What the e2e suites need Node's `fetch` to behave like: a browser's.
 *
 * THE FLAKE THIS EXISTS FOR, and why it is a harness concern and not a product one. The daemon
 * answers `Connection: close` on every response (README section 3.5 — one request per
 * connection). A browser honours that and opens a fresh connection for the next request, which is
 * what the panel actually does inside a webview. Node's `fetch` is undici, which keeps a
 * connection pool: under load a request can be written onto a socket the daemon has already
 * closed, and then it waits for headers that will never come — 300 s, twice, and a suite that
 * took ten minutes instead of ten seconds.
 *
 * So every request made from these suites gets a deadline, and a request that is **safe to send
 * twice** gets one retry. `POST /run` is not one of those: the daemon may have started the turn
 * and spent a transcript round, so it gets the deadline and no retry — a stalled turn is a red
 * test, which is the right answer.
 *
 * Nothing about the client under test changes. `lib/api.ts` calls the global through its own
 * wrapper, and this is the global.
 */
import { afterAll, beforeAll } from "vitest";

/** Long enough that a loopback request under a busy machine is not cut off. */
const DEADLINE_MS = 30_000;
/** A streamed turn may legitimately take longer than one request. */
const TURN_DEADLINE_MS = 90_000;

type Fetch = typeof globalThis.fetch;

let real: Fetch | null = null;

/** A request that may be sent a second time with no effect the first one already had. */
function replayable(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = typeof input === "string" ? input : String(input);
  if (path.includes("/run")) return false;
  if (path.includes("/decisions/")) return false;
  if (path.includes("/connectors/")) return false;
  return method === "GET" || path.endsWith("/manifest");
}

beforeAll(() => {
  if (real !== null) return;
  real = globalThis.fetch;
  const send: Fetch = async (input, init) => {
    const deadline = String(input).includes("/run") ? TURN_DEADLINE_MS : DEADLINE_MS;
    const attempts = replayable(input, init) ? 2 : 1;
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const abort = AbortSignal.timeout(deadline);
      try {
        // The caller's own signal still wins; this only adds a ceiling.
        const signal = init?.signal ? AbortSignal.any([init.signal, abort]) : abort;
        return await real!(input, { ...init, signal });
      } catch (error) {
        last = error;
        if (!abort.aborted) throw error;
      }
    }
    throw last;
  };
  globalThis.fetch = send;
});

afterAll(() => {
  if (real !== null) globalThis.fetch = real;
  real = null;
});
