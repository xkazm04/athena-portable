/** Tests for the Adopt studio's client — ADR 0097. A fake `fetch`; no daemon, no network. */
import { describe, expect, it } from "vitest";

import { ApiError, type FetchLike } from "@/lib/api";
import { ADOPT_EVENT_KINDS } from "@/lib/adopt";

import { AdoptApi, documentRefusal, parseAdoptEvent, toBase64 } from "./adopt-client";

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
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

describe("reading an event", () => {
  const samples: Record<string, Record<string, unknown>> = {
    "adopt.progress": { text: "Reading…" },
    "adopt.say": { text: "Hello **you**" },
    "adopt.questions": { round: 1, questions: [{ id: "q", slot_ids: ["s"], text: "Which?", options: [{ id: "a", label: "A" }], multi: false, allow_text: true }] },
    "adopt.slots": { slots: [{ id: "s", kind: "portal", label: "Mail", status: "open", value: "", source: "default" }] },
    "adopt.lane": { lane: { id: "r", kind: "rules", title: "Rules", status: "running", summary: "", findings: [] } },
    "adopt.brief": { rev: 2, md: "x", command: "do it", portals: { Postwren: "Gmail" }, open_slot_ids: ["s"] },
    "adopt.clear": { rev: 2 },
    "adopt.showcase": { status: "running", turn: 3, total: 9, trace: [], found_usd: null, found_reason: "shaped", detail: "" },
    "adopt.usage": { leg: "interview", model: "claude-sonnet-5-5", effort: "low", ms: 1200, first_text_ms: 300 },
    "adopt.verdict": {
      fit: "template",
      playbook_id: "travel-credit-refunds",
      why: "It fits.",
      differs: "Your airline.",
      alternates: [{ playbook_id: "carrier-refunds", title: "Late-parcel refunds", why: "Close." }],
      need: "I want my credits back.",
      command: "",
    },
    "adopt.error": { reason: "engine_error", detail: "boom" },
  };

  it("reads every kind of the contract with its fields", () => {
    for (const kind of ADOPT_EVENT_KINDS) {
      const e = parseAdoptEvent(JSON.stringify({ kind, seq: 7, ...samples[kind] }));
      expect(e, kind).not.toBeNull();
      expect(e!.kind).toBe(kind);
      expect(e!.seq).toBe(7);
      expect(e, kind).toMatchObject(samples[kind]!);
    }
  });

  it("reads a showcase without found_reason, from an older daemon, as none withheld", () => {
    const e = parseAdoptEvent(JSON.stringify({ kind: "adopt.showcase", seq: 1, status: "done", found_usd: 4 }));
    expect(e).toMatchObject({ found_usd: 4, found_reason: "" });
    const odd = parseAdoptEvent(JSON.stringify({ kind: "adopt.showcase", seq: 2, found_reason: "nope" }));
    expect(odd).toMatchObject({ found_reason: "" });
  });

  it("drops what is not an event: bad JSON, an unknown kind, no seq, a lane event without a lane", () => {
    expect(parseAdoptEvent("{")).toBeNull();
    expect(parseAdoptEvent(JSON.stringify({ kind: "adopt.nope", seq: 1 }))).toBeNull();
    expect(parseAdoptEvent(JSON.stringify({ kind: "adopt.say", text: "x" }))).toBeNull();
    expect(parseAdoptEvent(JSON.stringify({ kind: "adopt.lane", seq: 1, lane: null }))).toBeNull();
  });

  it("fills absent fields with the contract's absent values and keeps at most four questions", () => {
    const q = { id: "q", text: "?" };
    const e = parseAdoptEvent(JSON.stringify({ kind: "adopt.questions", seq: 1, questions: [q, q, q, q, q] }));
    expect(e).toMatchObject({ round: 0 });
    if (e?.kind !== "adopt.questions") throw new Error("kind");
    expect(e.questions).toHaveLength(4);
    expect(e.questions[0]).toEqual({ id: "q", slot_ids: [], text: "?", options: [], multi: false, allow_text: true });
  });
});

describe("the routes", () => {
  it("starts a session with the playbook id and the token", async () => {
    const { calls, f } = fake(() => json({ ok: true, session_id: "s1", slots: [{ id: "x", kind: "fact", label: "L" }] }));
    const reply = await new AdoptApi(() => AT, f).start("travel-credit-refunds");
    expect(reply.session_id).toBe("s1");
    expect(reply.slots[0]).toMatchObject({ id: "x", status: "open", source: "default", value: "" });
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/adopt");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ playbook_id: "travel-credit-refunds" });
    expect((calls[0]!.init.headers as Record<string, string>)["X-Athena-Token"]).toBe("tok");
  });

  it("follows the events after a seq, frame by frame, skipping a frame that is not one", async () => {
    const { calls, f } = fake(() =>
      sse([
        'event: adopt.say\ndata: {"kind":"adopt.say","seq":4,"text":"hi"}\n\n',
        "data: not json\n\n",
        'event: adopt.clear\r\ndata: {"kind":"adopt.clear","seq":5,"rev":1}\r\n\r\n',
      ]),
    );
    const out = [];
    for await (const e of new AdoptApi(() => AT, f).events("s/1", 3, new AbortController().signal)) out.push(e);
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/adopt/s%2F1/events?after=3");
    expect(calls[0]!.init.method).toBe("GET");
    expect(out.map((e) => e.seq)).toEqual([4, 5]);
  });

  it("posts answers with their channel, documents, enough, approve with its rev, and deletes on close", async () => {
    const { calls, f } = fake(() => json({ ok: true, doc_id: "d1" }));
    const api = new AdoptApi(() => AT, f);
    await api.answer("s", [{ question_id: "q", choice_ids: ["a"], text: "and b" }], "voice");
    expect(await api.document("s", { name: "x.pdf", mime: "application/pdf", data_b64: "AA==" })).toBe("d1");
    await api.enough("s");
    await api.approve("s", 3);
    await api.close("s");
    expect(calls.map((c) => `${c.init.method} ${c.url.slice(AT.url.length)}`)).toEqual([
      "POST /adopt/s/answer",
      "POST /adopt/s/documents",
      "POST /adopt/s/enough",
      "POST /adopt/s/approve",
      "DELETE /adopt/s",
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      answers: [{ question_id: "q", choice_ids: ["a"], text: "and b" }],
      via: "voice",
    });
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ rev: 3 });
  });

  it("reopens a saved case, lists the cases, and reads the case an approval was saved to (ADR 0123)", async () => {
    const summary = {
      case_id: "proj_0123456789ab",
      playbook_id: "travel-credit-refunds",
      title: "Airline credits",
      approved_rev: 2,
      approved_at: "2026-10-08T17:42:00+00:00",
      created: "2026-10-01T09:00:00+00:00",
      confirmed: 7,
      slots: 9,
    };
    const { calls, f } = fake((url) =>
      url.includes("/adopt/cases")
        ? json({ ok: true, cases: [summary, { case_id: "proj_ffffffffffff" }], showing: 2, total: 3, footer: "(showing 2 of 3)" })
        : url.endsWith("/approve")
          ? json({ ok: true, rev: 2, case_id: "proj_0123456789ab", case_problem: "" })
          : json({ ok: true, session_id: "s2", slots: [], case: summary }),
    );
    const api = new AdoptApi(() => AT, f);
    const reply = await api.start("travel-credit-refunds", "", "proj_0123456789ab");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      playbook_id: "travel-credit-refunds",
      case_id: "proj_0123456789ab",
    });
    expect(reply.case).toEqual(summary);

    const listed = await api.cases("travel credit/x");
    expect(calls[1]!.init.method).toBe("GET");
    expect(calls[1]!.url).toBe("http://127.0.0.1:9/adopt/cases?playbook_id=travel%20credit%2Fx");
    expect(listed.cases[0]).toEqual(summary);
    // A thin row reads to the contract's absent values, never a crash.
    expect(listed.cases[1]).toMatchObject({ case_id: "proj_ffffffffffff", title: "", approved_rev: 0, slots: 0 });
    expect([listed.showing, listed.total, listed.footer]).toEqual([2, 3, "(showing 2 of 3)"]);

    expect(await api.approve("s2", 2)).toEqual({ rev: 2, case_id: "proj_0123456789ab", case_problem: "" });
  });

  it("starts with no case when the daemon names none", async () => {
    const { f } = fake(() => json({ ok: true, session_id: "s1", slots: [] }));
    expect((await new AdoptApi(() => AT, f).start("x")).case).toBeNull();
  });

  it("says offline with no endpoint or no answer, and the daemon's own reason for a refusal", async () => {
    const none = new AdoptApi(() => null, () => Promise.reject(new Error("unreached")));
    await expect(none.start("x")).rejects.toMatchObject({ reason: "offline" });
    const dead = new AdoptApi(() => AT, () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(dead.start("x")).rejects.toMatchObject({ reason: "offline", message: "Failed to fetch" });
    const { f } = fake(() => json({ ok: false, reason: "engine_missing", detail: "No claude CLI on PATH." }, 503));
    const refused = new AdoptApi(() => AT, f).start("x");
    await expect(refused).rejects.toBeInstanceOf(ApiError);
    await expect(refused).rejects.toMatchObject({ status: 503, reason: "engine_missing", message: "No claude CLI on PATH." });
  });
});

describe("documents", () => {
  it("takes a PDF, an image or text up to 10 MB, and says why not otherwise", () => {
    expect(documentRefusal({ name: "a.pdf", size: 1000, type: "application/pdf" })).toBe("");
    expect(documentRefusal({ name: "a.docx", size: 1000, type: "application/msword" })).toMatch(/not a PDF/);
    expect(documentRefusal({ name: "big.png", size: 11 * 1024 * 1024, type: "image/png" })).toMatch(/over 10 MB/);
    expect(documentRefusal({ name: "e.txt", size: 0, type: "text/plain" })).toMatch(/empty/);
  });

  it("encodes bytes as base64 in slices", () => {
    expect(toBase64(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(atob(toBase64(big))).toHaveLength(big.length);
  });
});
