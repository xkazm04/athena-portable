/** Tests for the Chores front door's client — ADR 0098. A fake `fetch`; no daemon, no network. */
import { describe, expect, it } from "vitest";

import { ApiError, type FetchLike } from "@/lib/api";

import { IntakeApi } from "./intake-client";

const AT = { url: "http://127.0.0.1:9", token: "tok" };

function fake(reply: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f: FetchLike = (url, init = {}) => {
    calls.push({ url, init });
    return Promise.resolve(reply(url, init));
  };
  return { calls, f };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sse = (frames: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(f));
        c.close();
      },
    }),
    { status: 200 },
  );

describe("IntakeApi", () => {
  it("starts a session on /intake with the token, and sends the need only when there is one", async () => {
    const { calls, f } = fake(() => json({ ok: true, session_id: "s1" }));
    const api = new IntakeApi(() => AT, f);
    expect((await api.start()).session_id).toBe("s1");
    await api.start("  I chase refunds.  ");
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/intake");
    expect(calls[0]!.init.method).toBe("POST");
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Athena-Token"],
    ).toBe("tok");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({});
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      need: "I chase refunds.",
    });
  });

  it("answers, decides and closes on the intake routes", async () => {
    const { calls, f } = fake(() => json({ ok: true }));
    const api = new IntakeApi(() => AT, f);
    await api.answer(
      "a/b",
      [{ question_id: "", choice_ids: [], text: "hi" }],
      "voice",
    );
    await api.decide("a/b");
    await api.close("a/b");
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", "http://127.0.0.1:9/intake/a%2Fb/answer"],
      ["POST", "http://127.0.0.1:9/intake/a%2Fb/decide"],
      ["DELETE", "http://127.0.0.1:9/intake/a%2Fb"],
    ]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      answers: [{ question_id: "", choice_ids: [], text: "hi" }],
      via: "voice",
    });
    expect(calls[1]!.init.body).toBeUndefined();
  });

  it("streams events from `after`, verdict included, and skips frames that are not events", async () => {
    const verdict = {
      kind: "adopt.verdict",
      seq: 3,
      fit: "template",
      playbook_id: "travel-credit-refunds",
      why: "It fits.",
      differs: "",
      alternates: [],
      need: "I want my credits back.",
      command: "",
    };
    const { calls, f } = fake(() =>
      sse([
        `data: ${JSON.stringify({ kind: "adopt.say", seq: 1, text: "Hi" })}\n\n`,
        ": heartbeat\n\n",
        "data: not json\n\n",
        `data: ${JSON.stringify(verdict)}\n\n`,
      ]),
    );
    const api = new IntakeApi(() => AT, f);
    const seen = [];
    for await (const e of api.events("s1", 2, new AbortController().signal))
      seen.push(e);
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/intake/s1/events?after=2");
    expect(seen.map((e) => e.kind)).toEqual(["adopt.say", "adopt.verdict"]);
  });

  it("says offline for no endpoint and for a fetch that never answered", async () => {
    await expect(new IntakeApi(() => null).start()).rejects.toMatchObject({
      reason: "offline",
    });
    const down: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));
    await expect(
      new IntakeApi(() => AT, down).decide("s"),
    ).rejects.toMatchObject({ reason: "offline" });
  });

  it("keeps the daemon's refusal as an ApiError with its reason and detail", async () => {
    const { f } = fake(() =>
      json(
        { reason: "budget_exhausted", detail: "busy: 3 sessions live" },
        429,
      ),
    );
    const err = await new IntakeApi(() => AT, f)
      .start()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, reason: "budget_exhausted" });
    expect((err as ApiError).message).toContain("busy:");
  });
});
