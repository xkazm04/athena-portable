/**
 * One daemon request door — README section 3.2, ADR 0098. Five clients (DaemonApi, ChoresApi,
 * AdoptApi, IntakeApi, SpacesApi) each carried their own copy of "send, and say what a failed
 * fetch is". The table asks every client the same four failures through a stubbed fetch and
 * counts the rows on which they do not give the same answer; the count is 0 or the door is not one.
 */
import { describe, expect, it } from "vitest";

import { AdoptApi } from "./adopt-client";
import { DaemonApi, type Endpoint, type FetchLike } from "./api";
import { reasonOf } from "@/companion/plain";
import { ChoresApi } from "./chores-client";
import { IntakeApi } from "./intake-client";
import { SpacesApi } from "./spaces";

const AT: Endpoint = { url: "http://127.0.0.1:9", token: "tok" };

type Door = (f: FetchLike) => Promise<unknown>;
const DOORS: Record<string, Door> = {
  DaemonApi: (f) => new DaemonApi(AT, f).health(),
  ChoresApi: (f) => new ChoresApi(() => AT, f).due(),
  AdoptApi: (f) => new AdoptApi(() => AT, f).cases("p"),
  IntakeApi: (f) => new IntakeApi(() => AT, f).start(),
  SpacesApi: (f) => new SpacesApi(() => AT, f).list(),
};

const FAILURES: Record<string, FetchLike> = {
  "the connection is refused": () => Promise.reject(new TypeError("Failed to fetch")),
  "a refusal names its reason, word and device": () =>
    Promise.resolve(
      new Response(JSON.stringify({ reason: "conflict", detail: "busy now", error: "window_closed", name: "Laptop" }), {
        status: 409,
      }),
    ),
  "a refusal that is not JSON": () => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 })),
  "a 2xx whose body is not JSON": () => Promise.resolve(new Response("<html>hello</html>", { status: 200 })),
  "a 2xx whose body is JSON null": () => Promise.resolve(new Response("null", { status: 200 })),
};

/** What the caller sees, as one comparable string. */
async function seen(door: Door, f: FetchLike): Promise<string> {
  try {
    await door(f);
    return "resolved";
  } catch (e) {
    const x = e as { name?: string; status?: unknown; reason?: unknown; message?: string; word?: unknown; device?: unknown };
    return [x.name, x.status, x.reason, x.message, x.word, x.device].join("|");
  }
}

describe("the daemon request door", () => {
  it("answers every failure the same in all five clients", async () => {
    const disagreeing: string[] = [];
    const table: Record<string, Record<string, string>> = {};
    for (const [failure, f] of Object.entries(FAILURES)) {
      table[failure] = {};
      for (const [client, door] of Object.entries(DOORS)) table[failure][client] = await seen(door, f);
      if (new Set(Object.values(table[failure])).size > 1) disagreeing.push(failure);
    }
    expect(disagreeing, JSON.stringify(table, null, 1)).toEqual([]);
  });

  it("says what each failure is", async () => {
    const f = Object.values(FAILURES);
    const door = DOORS.IntakeApi;
    expect(await seen(door, f[0])).toBe("ApiError|0|offline|Failed to fetch||");
    expect(await seen(door, f[1])).toBe("ApiError|409|conflict|busy now|window_closed|Laptop");
    expect(await seen(door, f[2])).toBe("ApiError|502|unknown|unknown||");
    expect(await seen(door, f[3])).toBe("resolved");
    expect(await seen(door, f[4])).toBe("resolved");
  });

  it("lets a caller's own abort through as the abort, not as offline", async () => {
    const stop = new AbortController();
    const aborted: FetchLike = () => {
      stop.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    };
    const api = new IntakeApi(() => AT, aborted);
    await expect(api.events("s", 0, stop.signal).next()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads as 'still starting' to her window, as the refused connection did before", async () => {
    const error = await DOORS.DaemonApi(FAILURES["the connection is refused"]).catch((e: unknown) => e);
    expect(reasonOf(error)).toBe("not_ready");
  });
});
