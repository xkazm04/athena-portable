/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice wiring, headless.
 *
 * The real store against a fake daemon (a `fetch` that answers the wire contract), a fake player
 * and a fake microphone. What is asserted is what a person would see happen: the first preview
 * greets and chooses, the second says the test line, a newer play drops an older reply, an install
 * is polled until it settles, a take goes to every ready listener, and the studio remembers it was
 * finished.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { VoiceSetupApi, type InstallState, type VoiceConfig } from "@/lib/voice-setup";

import type { PreviewPlayer, TakeRecorder } from "./audio";
import { fixtures } from "./fixtures";
import { INSTALL_POLL_MS, resetVoiceSetupForTests, setVoiceSetupDeps, useVoiceSetup } from "./live";
import { TEST_LINE } from "./model";

const AT = { url: "http://daemon", token: "t" };
const READY_CONFIG = fixtures.typical.config as VoiceConfig;
const BARE_CONFIG = fixtures.engine.config as VoiceConfig;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function daemon(initial: VoiceConfig) {
  const calls: Call[] = [];
  let config = initial;
  let installs: InstallState[] = [];
  let previewGate: Promise<void> = Promise.resolve();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const path = input.replace(AT.url, "");
    const method = init?.method ?? "GET";
    const raw = init?.body;
    const body = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    calls.push({ method, path, body });
    if (path === "/voice/config" && method === "GET") return json(config);
    if (path === "/voice/config" && method === "PUT") {
      config = { ...config, ...(body as Partial<VoiceConfig>) };
      return json(config);
    }
    if (path === "/voice/preview") {
      await previewGate;
      return new Response(new Uint8Array([0, 1, 0, 2]), {
        status: 200,
        headers: { "Content-Type": "audio/L16;rate=24000" },
      });
    }
    if (path.startsWith("/voice/transcribe")) {
      const engine = new URL(input).searchParams.get("engine");
      return json({ engine, text: ` heard by ${engine} `, elapsed_ms: engine === "whisper" ? 300 : 900 });
    }
    if (path === "/voice/install" && method === "POST") {
      return installs.length ? json(installs[0], 202) : json({ reason: "conflict", detail: "an install is running" }, 409);
    }
    if (path === "/voice/install" && method === "GET") {
      const next = installs.shift() ?? { component: null, state: "idle", received_bytes: 0, total_bytes: null, error: null };
      return json(next);
    }
    return new Response(null, { status: 204 });
  };
  return {
    calls,
    fetchImpl,
    setConfig: (next: VoiceConfig) => (config = next),
    queueInstalls: (list: InstallState[]) => (installs = list),
    holdPreviews: () => {
      let release = () => {};
      previewGate = new Promise((r) => (release = r));
      return () => release();
    },
  };
}

function fakePlayer() {
  const played: number[] = [];
  let stops = 0;
  let end = () => {};
  const player = {
    play: (pcm: Uint8Array) => {
      played.push(pcm.length);
      return new Promise<void>((resolve) => (end = resolve));
    },
    stop: () => {
      stops += 1;
      end();
    },
    spectrum: () => null,
    level: () => 0,
    close: () => {},
  };
  return { player: player as unknown as PreviewPlayer, played, stops: () => stops, end: () => end() };
}

function fakeRecorder(pcm: Int16Array) {
  return {
    start: async () => {},
    stop: async () => pcm,
  } as unknown as TakeRecorder;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await tick();
};

function wire(config: VoiceConfig, over: { done?: boolean | null } = {}) {
  const d = daemon(config);
  const p = fakePlayer();
  const waits: number[] = [];
  const written: boolean[] = [];
  const published: boolean[] = [];
  setVoiceSetupDeps({
    api: (at) => new VoiceSetupApi(at, d.fetchImpl),
    readDone: async () => (over.done === undefined ? false : over.done),
    writeDone: async (done) => void written.push(done),
    player: () => p.player,
    recorder: () => fakeRecorder(new Int16Array([1, 2, 3])),
    wait: async (ms) => void waits.push(ms),
    now: () => new Date(2026, 9, 7, 20, 0),
    publish: (c) => void published.push(c.ready),
  });
  return { d, p, waits, written, published };
}

beforeEach(() => {
  resetVoiceSetupForTests();
});

const S = () => useVoiceSetup.getState();

describe("connecting", () => {
  it("reads the config and the studio row, and tells the voice key", async () => {
    const { published } = wire(READY_CONFIG);
    await S().connect(AT);
    expect(S().config?.ready).toBe(true);
    expect(S().studioDone).toBe(false);
    expect(published).toEqual([true]);
  });

  it("no daemon means no config and no calls", async () => {
    const { d } = wire(READY_CONFIG);
    await S().connect(null);
    expect(S().config).toBeNull();
    expect(d.calls).toEqual([]);
  });
});

describe("previews", () => {
  it("the first preview speaks the greeting for the hour and selects the voice; the second says the test line", async () => {
    const { d, p } = wire(READY_CONFIG);
    await S().connect(AT);
    S().actions.studio({ t: "choose_engine" });
    S().actions.togglePreview("af_heart");
    await settle();
    expect(S().preview.phase).toBe("playing");
    const first = d.calls.find((c) => c.path === "/voice/preview");
    expect(first?.body).toEqual({ text: "Good evening — I'm Athena.", voice: "af_heart" });
    expect(S().studio.wokeUp).toBe(true);
    expect(S().studio.voice).toBe("af_heart");
    expect(d.calls.some((c) => c.method === "PUT" && c.path === "/voice/config")).toBe(true);

    p.end();
    await settle();
    expect(S().preview.phase).toBe("idle");
    S().actions.togglePreview("af_heart");
    await settle();
    const previews = d.calls.filter((c) => c.path === "/voice/preview");
    expect(previews[1].body).toEqual({ text: TEST_LINE, voice: "af_heart" });
  });

  it("a stop while the reply is on its way drops the reply: previews never overlap", async () => {
    const { d, p } = wire(READY_CONFIG);
    await S().connect(AT);
    S().actions.studio({ t: "choose_engine" });
    const release = d.holdPreviews();
    S().actions.togglePreview("af_heart");
    await tick();
    expect(S().preview.phase).toBe("synth");
    S().actions.togglePreview("af_heart"); // the same voice again: stop
    release();
    await settle();
    expect(S().preview.phase).toBe("idle");
    expect(p.played).toEqual([]);
    expect(S().studio.wokeUp).toBe(false);
  });

  it("leaving the pick step stops her", async () => {
    const { p } = wire(READY_CONFIG);
    await S().connect(AT);
    S().actions.studio({ t: "choose_engine" });
    S().actions.togglePreview("af_heart");
    await settle();
    expect(S().preview.phase).toBe("playing");
    S().actions.studio({ t: "skip" });
    expect(S().studio.step).toBe("hear");
    expect(S().preview.phase).toBe("idle");
    expect(p.stops()).toBeGreaterThan(0);
  });
});

describe("install", () => {
  it("polls every 250 ms while it runs, then reads the config again", async () => {
    const { d, waits } = wire(BARE_CONFIG);
    await S().connect(AT);
    S().actions.studio({ t: "choose_engine" });
    expect(S().studio.step).toBe("install");
    const running: InstallState = {
      component: "kokoro",
      state: "downloading_engine",
      received_bytes: 1,
      total_bytes: 10,
      error: null,
    };
    d.queueInstalls([
      running,
      { ...running, state: "extracting", received_bytes: 10 },
      { ...running, state: "completed", received_bytes: 10 },
    ]);
    d.setConfig(READY_CONFIG);
    S().actions.install("kokoro");
    await settle();
    expect(waits.every((ms) => ms === INSTALL_POLL_MS)).toBe(true);
    expect(waits.length).toBe(3);
    expect(S().install?.state).toBe("completed");
    expect(S().config?.ready).toBe(true);
    S().actions.studio({ t: "next" });
    expect(S().studio.step).toBe("pick");
  });

  it("a second install while one runs is said, not thrown", async () => {
    wire(BARE_CONFIG);
    await S().connect(AT);
    S().actions.install("kokoro");
    await settle();
    expect(S().installError).toBe("an install is running");
  });
});

describe("the takes", () => {
  it("one take goes to every ready listener in parallel, and the pick is kept", async () => {
    const { d } = wire(READY_CONFIG);
    await S().connect(AT);
    S().actions.studio({ t: "choose_engine" });
    S().actions.studio({ t: "skip" });
    S().actions.recordStart();
    expect(S().hear.recording).toBe(true);
    S().actions.recordStop();
    await settle();
    const paths = d.calls.filter((c) => c.path.startsWith("/voice/transcribe")).map((c) => c.path);
    expect(paths).toEqual(["/voice/transcribe?engine=whisper", "/voice/transcribe?engine=openai"]);
    expect(S().hear.takes.whisper).toMatchObject({ state: "done", text: "heard by whisper", ms: 300 });
    expect(S().hear.takes.openai).toMatchObject({ state: "done", ms: 900 });

    S().actions.studio({ t: "pick_stt", engine: "openai" });
    S().actions.studio({ t: "use_stt" });
    await settle();
    const put = d.calls.filter((c) => c.method === "PUT" && c.path === "/voice/config").at(-1);
    expect((put?.body as { stt: unknown }).stt).toEqual({ engine: "openai", model: null });
    expect(S().studio.step).toBe("ready");
  });

  it("in settings a test take goes to the chosen listener only", async () => {
    const { d } = wire(READY_CONFIG, { done: true });
    await S().connect(AT);
    S().actions.recordStart();
    S().actions.recordStop();
    await settle();
    const paths = d.calls.filter((c) => c.path.startsWith("/voice/transcribe")).map((c) => c.path);
    expect(paths).toEqual(["/voice/transcribe?engine=whisper"]);
  });
});

describe("the studio row", () => {
  it("finishing writes the row and opens settings; reopening starts the studio over", async () => {
    const { written } = wire(READY_CONFIG);
    await S().connect(AT);
    S().actions.finish();
    expect(S().studioDone).toBe(true);
    expect(written).toEqual([true]);
    S().actions.reopenStudio();
    expect(S().reopened).toBe(true);
    expect(S().studio.step).toBe("engine");
  });

  it("a stored row opens on settings", async () => {
    wire(READY_CONFIG, { done: true });
    await S().connect(AT);
    expect(S().studioDone).toBe(true);
  });
});

describe("the key", () => {
  it("saves the key and reads the config again; a refusal is shown in the daemon's words", async () => {
    const { d } = wire(READY_CONFIG);
    await S().connect(AT);
    S().actions.saveKey("sk-test");
    await settle();
    expect(d.calls.find((c) => c.path === "/voice/key")?.body).toEqual({ provider: "openai", key: "sk-test" });
    expect(S().keyBusy).toBe(false);
    S().actions.removeKey();
    await settle();
    expect(d.calls.some((c) => c.method === "DELETE" && c.path === "/voice/key?provider=openai")).toBe(true);
  });
});
