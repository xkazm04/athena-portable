/**
 * `src/lib/voice.ts` and `src/stores/voice.ts` against the real `/voice` socket — ADR 0019, 0020.
 *
 * Act 2 of the demo is a spoken turn and a spoken approval, and `src/stores/voice.test.ts` fakes
 * the socket, the microphone and the player entirely — so nothing until now has run this client
 * against a real WebSocket handshake, real 4-byte generation headers, or the gateway's real
 * refusals. This file does, with the daemon's scripted backend standing in for the microphone and
 * the speech model and nothing else.
 *
 * What is still faked, and why: the *player* (there is no `AudioContext` in Node, so a recorder
 * takes its place and the generation it is handed is the one `splitAudioFrame` read off the real
 * bytes) and the *microphone* (a function that hands PCM to the real `sendAudio`, so the framing
 * on the wire is the shipped one). The mic in WebView2 is still unverified by hand; this proves
 * everything downstream of it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";

import { DaemonApi } from "@/lib/api";
import { PROTOCOL_PREFIX, VOICE_PATH, VoiceSocket, voiceUrl, type Player, type SocketLike } from "@/lib/voice";
import { resetRunForTests, setRunDeps, useRun, type RunDeps } from "@/stores/run";
import { resetVoiceForTests, setVoiceDeps, startVoice, useVoice, type VoiceDeps } from "@/stores/voice";

import { startDaemon, type Daemon } from "./support/daemon";
import { APP_ID, PAGE_ORIGIN, fakePage, manifestBody, WRITE_TOOL, type FakePage } from "./support/page";

/** Every chunk the player was handed, with the generation the client read off the frame. */
interface PlayerLog {
  played: Array<{ generation: number; bytes: number; sampleRate: number }>;
  dropped: number[];
  finished: number[];
  player: Player;
}

function playerLog(): PlayerLog {
  const log: PlayerLog = {
    played: [],
    dropped: [],
    finished: [],
    player: null as unknown as Player,
  };
  log.player = {
    play: (generation: number, pcm: Uint8Array, sampleRate: number) =>
      log.played.push({ generation, bytes: pcm.byteLength, sampleRate }),
    drop: (generation: number) => log.dropped.push(generation),
    finished: (generation: number) => log.finished.push(generation),
    playing: () => false,
  } as unknown as Player;
  return log;
}

interface Live {
  daemon: Daemon;
  page: FakePage;
  audio: PlayerLog;
  /** Every PCM chunk the fake microphone handed to the real socket. */
  mic: () => number;
  chunk: () => void;
}

let running: Daemon | null = null;

async function live(
  transcript: string,
  options: { utterances?: string[] } = {},
): Promise<Live> {
  const daemon = await startDaemon({
    transcript: `e2e/transcripts/${transcript}`,
    voice: "scripted",
    utterances: options.utterances ?? [],
  });
  running = daemon;
  const page = fakePage({ pay: "paid", list_overdue: "INV-118, INV-120, INV-131" });
  const audio = playerLog();
  const endpoint = () => ({ url: daemon.url, token: daemon.token });
  let sent = 0;
  let feed: ((pcm: Int16Array) => void) | null = null;

  const deps: VoiceDeps = {
    endpoint,
    health: () => new DaemonApi(endpoint()).health(),
    // The real DOM-shaped `WebSocket`, which Node has had since 22. The client's own `connect`
    // is what puts the token in the subprotocol, and the daemon's `_socket_token` is what reads
    // it: both halves of ADR 0019's answer to "a browser cannot set a header on an upgrade".
    socket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    openMic: async (onChunk) => {
      feed = onChunk;
      return { stop: () => (feed = null) };
    },
    player: () => audio.player,
    focused: () => ({ tabId: 7, origin: PAGE_ORIGIN, appId: APP_ID }),
    hostState: () => ({ page_url: `${PAGE_ORIGIN}/invoices`, page_title: "Ledgerbox", tabs: [] }),
    call: page.call,
    manifest: () => manifestBody(),
  };
  setVoiceDeps(deps);
  // The panel's HTTP half, for the card the button answers.
  const runDeps: RunDeps = {
    api: () => new DaemonApi(endpoint()),
    focused: deps.focused,
    hostState: deps.hostState,
    call: page.call,
    manifest: () => manifestBody(),
  };
  setRunDeps(runDeps);
  await startVoice();
  return {
    daemon,
    page,
    audio,
    mic: () => sent,
    chunk: () => {
      // 160 ms of 16 kHz PCM16, as the real `ScriptProcessorNode` path would produce.
      feed?.(new Int16Array(2_560));
      sent += 1;
    },
  };
}

afterEach(async () => {
  resetVoiceForTests();
  resetRunForTests();
  const daemon = running;
  running = null;
  await daemon?.stop();
});

/** Wait until `f()` holds, or fail with what the store looked like instead. */
async function until(f: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (f()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `${what} did not happen within ${ms} ms. voice=${JSON.stringify(useVoice.getState())} run=${JSON.stringify(
      useRun.getState().transcript,
    )}`,
  );
}

// -- the handshake -------------------------------------------------------------------------------

describe("the handshake", () => {
  it("rewrites http to ws and is accepted with the token on the subprotocol", async () => {
    const { daemon } = await live("voice-plain.ndjson");

    expect(voiceUrl(daemon.url)).toBe(`${daemon.url.replace("http", "ws")}${VOICE_PATH}`);
    // `/health` lists the socket only when a backend is configured, and that is the one fact the
    // push-to-talk key reads to decide whether it does anything at all.
    const health = await new DaemonApi({ url: daemon.url, token: daemon.token }).health();
    expect(health.sockets).toEqual([VOICE_PATH]);
    expect(useVoice.getState().available).toBe(true);
    expect(useVoice.getState().phase).toBe("idle");
    expect(useVoice.getState().reason).toBe("");

    const opened = new VoiceSocket(
      (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      { onEvent: () => {}, onAudio: () => {}, onClose: () => {} },
    );
    await opened.connect(daemon.url, daemon.token);
    expect(opened.open).toBe(true);
    opened.close();
  });

  it("refuses a wrong token with the daemon's own JSON refusal rather than a hang", async () => {
    const { daemon } = await live("voice-plain.ndjson");

    // The upgrade, by hand, so the status and the body can both be read. A browser would only
    // see the failure; the contract is that the daemon answers in the one refusal shape.
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(daemon.url);
      const req = httpRequest(
        {
          host: url.hostname,
          port: Number(url.port),
          path: VOICE_PATH,
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
            "Sec-WebSocket-Protocol": `${PROTOCOL_PREFIX}not-the-token`,
          },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf-8");
          res.on("data", (c: string) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(answer.status).toBe(401);
    expect(JSON.parse(answer.body)).toMatchObject({ reason: "foreign_token" });

    // And the client's own `connect` rejects rather than never settling.
    const socket = new VoiceSocket(
      (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      { onEvent: () => {}, onAudio: () => {}, onClose: () => {} },
    );
    await expect(socket.connect(daemon.url, "not-the-token")).rejects.toThrow(
      "the voice socket could not be opened",
    );
  });
});

// -- one spoken turn -----------------------------------------------------------------------------

describe("one spoken utterance", () => {
  it("runs one ordinary turn whose frames land in the panel's own transcript", async () => {
    const { daemon, audio, chunk, mic } = await live("voice-plain.ndjson", {
      utterances: ["what is overdue?"],
    });

    await useVoice.getState().press();
    expect(useVoice.getState().phase).toBe("listening");
    // Real PCM16 through the real `sendAudio`: the little-endian conversion and the binary
    // frame are the shipped ones, and the daemon's transcriber is fed by them.
    for (let i = 0; i < 3; i += 1) chunk();
    expect(mic()).toBe(3);

    useVoice.getState().release();
    expect(useVoice.getState().phase).toBe("thinking");

    await until(
      () => useRun.getState().transcript.some((e) => e.text.includes("past thirty days")),
      "the turn to reach the panel's transcript",
    );

    const said = useRun.getState().transcript;
    // `voice.transcript` with `final: true` becomes the user's own line — the one the panel
    // renders on the right, in the words the speech model heard.
    expect(said[0]).toMatchObject({ kind: "user", text: "what is overdue?" });
    expect(said[1].kind).toBe("assistant");
    expect(said[1].text).toContain("Three invoices are past thirty days.");
    expect(useRun.getState().summary?.engine).toBe("claude_code");

    // The spoken line came back as generation-tagged audio, and the generation the player was
    // handed is the one the daemon announced on `voice.speaking`.
    await until(() => audio.played.length > 0, "audio to arrive");
    const generations = new Set(audio.played.map((p) => p.generation));
    expect(generations.size).toBe(1);
    expect([...generations][0]).toBeGreaterThanOrEqual(1);
    expect(audio.played.every((p) => p.bytes > 0)).toBe(true);
    expect(audio.played.every((p) => p.sampleRate === 16_000)).toBe(true);

    // README invariant 6, and the thing the film claims: the row says voice.
    const ledger = (await new DaemonApi({ url: daemon.url, token: daemon.token }).ledger()) as {
      rows: Array<Record<string, unknown>>;
    };
    const rows = ledger.rows.filter((r) => r.surface === "voice");
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger).toBe("voice");
    expect(rows[0].origin).toBe(`host:${APP_ID}`);
    expect(rows[0].is_error).toBe(false);
  });

  it("refuses a page it has no manifest for, and the panel's own step is what prevents it", async () => {
    const { daemon } = await live("voice-plain.ndjson", { utterances: ["what is overdue?"] });

    // The gateway refuses an unregistered origin exactly as `POST /run` does. Publishing the
    // manifest is the first thing `press` does; take it away and the spoken turn cannot start —
    // which is what the shipped store did until this suite was written.
    setVoiceDeps({ ...depsOf(daemon), manifest: () => null });
    await useVoice.getState().say("what is overdue?");

    await until(
      () => useVoice.getState().phase === "error" || useVoice.getState().reason !== "",
      "the gateway's refusal to reach the store",
    );
    expect(useVoice.getState().reason).toContain("foreign_origin");
  });
});

// -- a spoken gated turn -------------------------------------------------------------------------

describe("a spoken gated proposal", () => {
  it("files a card the panel's button answers over HTTP, and only then does the page run", async () => {
    const { daemon, page } = await live("voice-gated.ndjson");

    await useVoice.getState().say("pay INV-118");

    await until(() => useRun.getState().cards.length === 1, "the card to reach the panel");
    // THE CLAIM, spoken: the page has not been touched, and will not be until the answer.
    expect(page.calls).toEqual([]);
    const card = useRun.getState().cards[0];
    expect(card.action).toBe(WRITE_TOOL);
    expect(card.params).toEqual({ invoice: "INV-118" });
    expect(card.surface).toBe("voice");

    // The same route the typed path uses: `POST /decisions/<id>`, and the `execute` it answers
    // with is the only thing the panel runs.
    await useRun.getState().answer(card.id, "approve");

    expect(page.names()).toEqual(["pay"]);
    expect(page.calls[0].input).toEqual({ invoice: "INV-118" });
    expect(useRun.getState().cards).toEqual([]);

    const ledger = (await new DaemonApi({ url: daemon.url, token: daemon.token }).ledger()) as {
      rows: Array<Record<string, unknown>>;
    };
    // One row for the spoken turn, and one for the resolution's continuation over HTTP. Both
    // are real invocations and both are recorded; neither is a decline.
    expect(ledger.rows.some((r) => r.surface === "voice")).toBe(true);
    expect(ledger.rows.every((r) => r.error_reason !== "user_denied")).toBe(true);
  });
});

// -- the socket going away -----------------------------------------------------------------------

describe("a socket that goes away mid-turn", () => {
  it("leaves the store in a phase the panel can render, with a reason, and not wedged", async () => {
    const { daemon } = await live("voice-plain.ndjson");

    await useVoice.getState().say("what is overdue?");
    expect(useVoice.getState().phase).toBe("thinking");

    running = null;
    await daemon.stop();

    await until(() => useVoice.getState().phase !== "thinking", "the close to reach the store");
    const state = useVoice.getState();
    // Not `listening`, not `thinking`: both of those render as a spinner that never stops.
    expect(["idle", "off", "error"]).toContain(state.phase);
    expect(state.reason).not.toBe("");
    expect(state.generation).toBeNull();
  });
});

/** The deps of a live daemon, for a test that wants to change exactly one of them. */
function depsOf(daemon: Daemon): VoiceDeps {
  const endpoint = () => ({ url: daemon.url, token: daemon.token });
  return {
    endpoint,
    health: () => new DaemonApi(endpoint()).health(),
    socket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    openMic: null,
    player: () => null,
    focused: () => ({ tabId: 7, origin: PAGE_ORIGIN, appId: APP_ID }),
    hostState: () => ({}),
    call: async () => ({ ok: true, output: "" }),
    manifest: () => null,
  };
}
