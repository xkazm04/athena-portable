import { describe, expect, it } from "vitest";

import { beginSetup, openSetup, SETUP_ORIGIN, type SetupSession } from "@/lib/setup";

const endpoint = { url: "http://127.0.0.1:17490", token: "t" };

describe("openSetup", () => {
  it("posts to the setup door with the window's token and returns the session", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const session = await openSetup(endpoint, async (url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          ok: true,
          origin: SETUP_ORIGIN,
          conversation_id: "conv_setup",
          phase: "ready",
        }),
        {
          status: 200,
        },
      );
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://127.0.0.1:17490/devices/setup");
    expect(seen[0].init?.method).toBe("POST");
    expect(
      (seen[0].init?.headers as Record<string, string>)["X-Athena-Token"],
    ).toBe("t");
    expect(session).toEqual({
      origin: SETUP_ORIGIN,
      conversation_id: "conv_setup",
      phase: "ready",
    });
  });

  it("refuses an answer that is not the setup session", async () => {
    const answer = async () =>
      new Response(
        JSON.stringify({ origin: "https://elsewhere", conversation_id: "x" }),
      );
    await expect(openSetup(endpoint, answer)).rejects.toThrow(
      "not the setup session",
    );
  });

  it("says when the daemon has no setup door", async () => {
    await expect(
      openSetup(endpoint, async () => new Response("{}", { status: 404 })),
    ).rejects.toThrow("404");
  });
});

describe("beginSetup", () => {
  const session: SetupSession = { origin: SETUP_ORIGIN, conversation_id: "conv_setup", phase: null };

  it("opens the door, then hands the session to her window", async () => {
    const order: string[] = [];
    const handed: SetupSession[] = [];
    await beginSetup({
      endpoint: () => endpoint,
      open: async () => {
        order.push("open");
        return session;
      },
      hand: async (s) => {
        order.push("hand");
        handed.push(s);
      },
    });
    expect(order).toEqual(["open", "hand"]);
    expect(handed).toEqual([session]);
  });

  it("hands nothing over when the door did not open, or the daemon is not there", async () => {
    const handed: SetupSession[] = [];
    const hand = async (s: SetupSession) => void handed.push(s);
    await expect(
      beginSetup({ endpoint: () => endpoint, hand, open: async () => Promise.reject(new Error("the setup conversation did not open (404)")) }),
    ).rejects.toThrow("404");
    await expect(beginSetup({ endpoint: () => null, hand })).rejects.toThrow("not running");
    expect(handed).toEqual([]);
  });
});
