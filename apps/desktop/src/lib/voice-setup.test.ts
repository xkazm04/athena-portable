/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the voice-setup client.
 *
 * Every route of the wire contract against a fake `fetch`: the method, the path, the token, the
 * body, and what comes back. A 503 and a 409 are asserted as states, because the studio renders
 * them; a fetch that throws is the state `offline`, never an exception.
 */
import { describe, expect, it } from "vitest";

import {
  VoiceSetupApi,
  availabilityOf,
  rateOf,
  refusalText,
  type InstallState,
  type VoiceConfig,
} from "./voice-setup";

const ENDPOINT = { url: "http://127.0.0.1:17490", token: "t0k" };

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fake(answer: (seen: Seen) => Response | Promise<Response>) {
  const calls: Seen[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const seen: Seen = {
      url: input,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ?? null,
    };
    calls.push(seen);
    return answer(seen);
  };
  return { api: new VoiceSetupApi(ENDPOINT, fetchImpl), calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const CONFIG: VoiceConfig = {
  tts: { engine: "kokoro", voice: "af_heart" },
  stt: { engine: "whisper", model: "base.en" },
  engines: [
    {
      id: "kokoro",
      direction: "tts",
      kind: "local",
      state: "ready",
      reason: null,
      size_mb: 400,
      voices: [
        { id: "af_heart", name: "Heart", language: "en-US", gender: "female", grade: "A", blurb: "warm" },
      ],
      models: [],
    },
  ],
  ready: true,
  reason: null,
  home: "~/.personas",
};

describe("the config routes", () => {
  it("GET /voice/config carries the token and answers the config", async () => {
    const { api, calls } = fake(() => json(CONFIG));
    const out = await api.config();
    expect(out).toEqual({ ok: true, value: CONFIG });
    expect(calls[0].url).toBe("http://127.0.0.1:17490/voice/config");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers["X-Athena-Token"]).toBe("t0k");
    expect(calls[0].body).toBeNull();
  });

  it("PUT /voice/config sends both halves of the choice", async () => {
    const { api, calls } = fake(() => json(CONFIG));
    await api.choose({ tts: { engine: "kokoro", voice: "af_heart" }, stt: { engine: "openai", model: null } });
    expect(calls[0].method).toBe("PUT");
    expect(JSON.parse(calls[0].body as string)).toEqual({
      tts: { engine: "kokoro", voice: "af_heart" },
      stt: { engine: "openai", model: null },
    });
  });

  it("a 400 is the state `invalid`, with the daemon's reason", async () => {
    const { api } = fake(() => json({ reason: "validator_failed", detail: null }, 400));
    const out = await api.choose({ tts: { engine: "kokoro", voice: "nope" }, stt: { engine: "whisper", model: "x" } });
    expect(out).toMatchObject({ ok: false, refusal: "invalid", status: 400, reason: "validator_failed" });
  });

  it("keeps null as null: a model the daemon left empty is not invented", async () => {
    const { api } = fake(() => json({ ...CONFIG, stt: { engine: "openai", model: null }, ready: false, reason: "no key" }));
    const out = await api.config();
    expect(out.ok && out.value.stt.model).toBeNull();
  });
});

describe("preview", () => {
  it("POSTs the text and the voice and reads the PCM and its headers", async () => {
    const { api, calls } = fake(
      () =>
        new Response(new Uint8Array([1, 0, 2, 0]), {
          status: 200,
          headers: {
            "Content-Type": "audio/L16;rate=22050",
            "X-Tts-Provider": "kokoro",
            "X-Tts-Voice": "af_heart",
            "X-Tts-Elapsed-Ms": "812",
          },
        }),
    );
    const out = await api.preview("Hello", "af_heart");
    expect(calls[0].url).toBe("http://127.0.0.1:17490/voice/preview");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body as string)).toEqual({ text: "Hello", voice: "af_heart" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([...out.value.pcm]).toEqual([1, 0, 2, 0]);
    expect(out.value.sampleRate).toBe(22050);
    expect(out.value.provider).toBe("kokoro");
    expect(out.value.voice).toBe("af_heart");
    expect(out.value.elapsedMs).toBe(812);
  });

  it("a 503 is the state `not_ready`, not a throw", async () => {
    const { api } = fake(() => json({ reason: "voice_unavailable", detail: "Kokoro is not installed" }, 503));
    const out = await api.preview("Hello", "af_heart");
    expect(out).toMatchObject({ ok: false, refusal: "not_ready", status: 503 });
    if (!out.ok) expect(refusalText(out)).toBe("Kokoro is not installed");
  });

  it("clips text to the contract's 1200 characters", async () => {
    const { api, calls } = fake(() => new Response(new Uint8Array(0), { status: 200 }));
    await api.preview("a".repeat(1500), "af_heart");
    expect((JSON.parse(calls[0].body as string) as { text: string }).text).toHaveLength(1200);
  });

  it("a header with no elapsed time is null, and a content type with no rate falls back", async () => {
    const { api } = fake(() => new Response(new Uint8Array(0), { status: 200, headers: { "Content-Type": "audio/L16" } }));
    const out = await api.preview("Hi", "af_heart");
    expect(out.ok && out.value.elapsedMs).toBeNull();
    expect(out.ok && out.value.sampleRate).toBe(24000);
  });
});

describe("transcribe", () => {
  it("POSTs raw little-endian PCM16 to the named engine and reads the transcript", async () => {
    const { api, calls } = fake(() => json({ engine: "whisper", text: "hello there", elapsed_ms: 340 }));
    const out = await api.transcribe("whisper", new Int16Array([1, -1]));
    expect(calls[0].url).toBe("http://127.0.0.1:17490/voice/transcribe?engine=whisper");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["Content-Type"]).toBe("application/octet-stream");
    expect([...(calls[0].body as Uint8Array)]).toEqual([1, 0, 0xff, 0xff]);
    expect(out).toEqual({ ok: true, value: { engine: "whisper", text: "hello there", elapsed_ms: 340 } });
  });

  it("an engine that is not ready is `not_ready`", async () => {
    const { api } = fake(() => json({ reason: "voice_unavailable", detail: "no key" }, 503));
    const out = await api.transcribe("openai", new Int16Array([0]));
    expect(out).toMatchObject({ ok: false, refusal: "not_ready" });
  });
});

describe("install", () => {
  const RUNNING: InstallState = {
    component: "kokoro",
    state: "downloading_model",
    received_bytes: 10,
    total_bytes: null,
    error: null,
  };

  it("POST /voice/install sends only the component, never a URL", async () => {
    const { api, calls } = fake(() => json(RUNNING, 202));
    const out = await api.install("whisper:base.en");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body as string)).toEqual({ component: "whisper:base.en" });
    expect(out).toEqual({ ok: true, value: RUNNING });
  });

  it("a second install while one runs is the state `busy`", async () => {
    const { api } = fake(() => json({ reason: "conflict", detail: "an install is running" }, 409));
    const out = await api.install("kokoro");
    expect(out).toMatchObject({ ok: false, refusal: "busy", status: 409 });
  });

  it("GET /voice/install answers the state, total_bytes null when unknown", async () => {
    const { api, calls } = fake(() => json(RUNNING));
    const out = await api.installState();
    expect(calls[0].url).toBe("http://127.0.0.1:17490/voice/install");
    expect(out.ok && out.value.total_bytes).toBeNull();
  });
});

describe("the key", () => {
  it("PUT /voice/key sends the key once and returns nothing", async () => {
    const { api, calls } = fake(() => new Response(null, { status: 204 }));
    const out = await api.putKey("openai", "sk-secret");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("http://127.0.0.1:17490/voice/key");
    expect(JSON.parse(calls[0].body as string)).toEqual({ provider: "openai", key: "sk-secret" });
    expect(out).toEqual({ ok: true, value: null });
  });

  it("DELETE /voice/key names the provider in the query", async () => {
    const { api, calls } = fake(() => new Response(null, { status: 204 }));
    const out = await api.deleteKey("openai");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("http://127.0.0.1:17490/voice/key?provider=openai");
    expect(out.ok).toBe(true);
  });
});

describe("failure states", () => {
  it("a fetch that throws is `offline`, with the error's words", async () => {
    const { api } = fake(() => {
      throw new TypeError("Failed to fetch");
    });
    const out = await api.config();
    expect(out).toMatchObject({ ok: false, refusal: "offline", status: 0, detail: "Failed to fetch" });
  });

  it("a refusal that is not JSON is still a refusal", async () => {
    const { api } = fake(() => new Response("gateway down", { status: 502 }));
    const out = await api.config();
    expect(out).toMatchObject({ ok: false, refusal: "refused", status: 502, reason: "unknown" });
    if (!out.ok) expect(refusalText(out)).toBe("the daemon answered 502");
  });
});

describe("pure helpers", () => {
  it("reads the rate from the content type", () => {
    expect(rateOf("audio/L16;rate=24000")).toBe(24000);
    expect(rateOf("audio/L16; rate = 16000")).toBe(16000);
    expect(rateOf(null)).toBe(24000);
  });

  it("maps ready/reason to availability, with a sentence whenever it is not ready", () => {
    expect(availabilityOf({ ready: true, reason: null })).toEqual({ available: true, reason: "" });
    expect(availabilityOf({ ready: false, reason: "Kokoro is not installed." })).toEqual({
      available: false,
      reason: "Kokoro is not installed.",
    });
    expect(availabilityOf({ ready: false, reason: null }).reason).toBe("voice is not set up yet");
  });
});
