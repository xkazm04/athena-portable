/**
 * The Adopt studio's client over the daemon — ADR 0097, README section 3.5.
 *
 * The routes and the event shapes are the contract's (`lib/adopt.ts`); this file only speaks them.
 * Like `lib/api.ts`, `fetch` is an argument and the endpoint is asked for at every call (the
 * daemon can restart on another port between two questions), so one client serves the app, the
 * preview harness and the tests. The event stream is a GET of SSE frames, parsed by the same
 * hand-written frame reader the run loop uses (`sseFrames`); each frame's JSON carries its own
 * `kind` (the daemon writes `to_dict()`, which leads with it), so the `event:` line is not needed.
 *
 * A refusal is an `ApiError` in the daemon's vocabulary; no endpoint, or a fetch that never got an
 * answer, is an `ApiError` whose reason is `offline`. Nothing here retries: the studio's session
 * hook owns the reconnect, because only it knows the last `seq` it drew.
 */
import { ApiError, sseFrames, type Endpoint, type FetchLike } from "@/lib/api";
import {
  ADOPT_EVENT_KINDS,
  ADOPT_ROUTES,
  type AdoptEvent,
  type AdoptEventKind,
  type Answer,
  type AnswerVia,
  type Lane,
  type Question,
  type Slot,
  type StartReply,
} from "@/lib/adopt";

/** What `POST /adopt/<sid>/documents` takes: at most this many bytes before base64. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The kinds of document the document lane reads. */
export const DOCUMENT_MIMES: readonly string[] = ["application/pdf", "image/png", "image/jpeg", "text/plain"];

export interface AdoptDocument {
  name: string;
  mime: string;
  data_b64: string;
}

export interface AdoptClient {
  /** A new session; `intro` is what the person says before the first card (optional). */
  start(playbookId: string, intro?: string): Promise<StartReply>;
  /** The session's events after `after`, as they arrive; ends when the daemon closes the stream. */
  events(sid: string, after: number, signal: AbortSignal): AsyncGenerator<AdoptEvent>;
  answer(sid: string, answers: readonly Answer[], via: AnswerVia): Promise<void>;
  /** Hand a document to the session; answers its `doc_id`. */
  document(sid: string, doc: AdoptDocument): Promise<string>;
  enough(sid: string): Promise<void>;
  approve(sid: string, rev: number): Promise<void>;
  close(sid: string): Promise<void>;
}

const globalFetch: FetchLike = (input, init) => fetch(input, init);

const offline = (detail: string) => new ApiError(0, "offline", detail);

export class AdoptApi implements AdoptClient {
  constructor(
    private readonly at: () => Endpoint | null,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async start(playbookId: string, intro?: string): Promise<StartReply> {
    const words = intro?.trim() ?? "";
    const reply = await this.json<Partial<StartReply>>(
      "POST",
      ADOPT_ROUTES.start,
      words ? { playbook_id: playbookId, intro: words } : { playbook_id: playbookId },
    );
    return {
      ok: true,
      session_id: String(reply.session_id ?? ""),
      slots: Array.isArray(reply.slots) ? reply.slots.map(slotOf) : [],
    };
  }

  async *events(sid: string, after: number, signal: AbortSignal): AsyncGenerator<AdoptEvent> {
    const response = await this.send("GET", ADOPT_ROUTES.events(sid, after), undefined, signal);
    if (!response.body) throw new ApiError(response.status, "engine_error", "the daemon streamed no body");
    for await (const frame of sseFrames(response.body)) {
      const event = parseAdoptEvent(frame);
      if (event !== null) yield event;
    }
  }

  async answer(sid: string, answers: readonly Answer[], via: AnswerVia): Promise<void> {
    await this.json("POST", ADOPT_ROUTES.answer(sid), { answers, via });
  }

  async document(sid: string, doc: AdoptDocument): Promise<string> {
    const reply = await this.json<{ doc_id?: string }>("POST", ADOPT_ROUTES.documents(sid), doc);
    return String(reply.doc_id ?? "");
  }

  async enough(sid: string): Promise<void> {
    await this.json("POST", ADOPT_ROUTES.enough(sid), {});
  }

  async approve(sid: string, rev: number): Promise<void> {
    await this.json("POST", ADOPT_ROUTES.approve(sid), { rev });
  }

  async close(sid: string): Promise<void> {
    await this.send("DELETE", ADOPT_ROUTES.session(sid));
  }

  private async send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const at = this.at();
    if (at === null) throw offline("The daemon is not running.");
    let response: Response;
    try {
      response = await this.fetchImpl(`${at.url}${path}`, {
        method,
        headers: { "X-Athena-Token": at.token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw offline(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw await refusal(response);
    return response;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    try {
      return (await response.json()) as T;
    } catch {
      return {} as T;
    }
  }
}

async function refusal(response: Response): Promise<ApiError> {
  let reason = "unknown";
  let detail = "";
  try {
    const payload = (await response.json()) as { reason?: string; detail?: string };
    reason = payload.reason ?? reason;
    detail = payload.detail ?? "";
  } catch {
    // Not JSON: the status is the refusal.
  }
  return new ApiError(response.status, reason, detail);
}

// -- reading an event ------------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown) => list(v).filter((x): x is string => typeof x === "string");
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  (all as readonly unknown[]).includes(v) ? (v as T) : d;

export function slotOf(raw: unknown): Slot {
  const r = isRaw(raw) ? raw : {};
  return {
    id: str(r.id),
    kind: oneOf(r.kind, ["portal", "gate", "fact", "trap"], "fact"),
    label: str(r.label),
    status: oneOf(r.status, ["open", "guessed", "confirmed"], "open"),
    value: str(r.value),
    source: oneOf(r.source, ["user", "research", "memory", "document", "account", "default"], "default"),
  };
}

function questionOf(raw: unknown): Question {
  const r = isRaw(raw) ? raw : {};
  return {
    id: str(r.id),
    slot_ids: strings(r.slot_ids),
    text: str(r.text),
    options: list(r.options)
      .filter(isRaw)
      .map((o) => ({ id: str(o.id), label: str(o.label) })),
    multi: r.multi === true,
    allow_text: r.allow_text !== false,
  };
}

function laneOf(raw: unknown): Lane | null {
  if (!isRaw(raw)) return null;
  return {
    id: str(raw.id),
    kind: oneOf(raw.kind, ["rules", "accounts", "memory", "document"], "rules"),
    title: str(raw.title),
    status: oneOf(raw.status, ["queued", "running", "done", "failed", "skipped"], "queued"),
    summary: str(raw.summary),
    findings: list(raw.findings)
      .filter(isRaw)
      .map((f) => ({ text: str(f.text), source_url: str(f.source_url), slot_ids: strings(f.slot_ids) })),
  };
}

/**
 * One SSE frame's data as an event, or `null` for anything that is not one: not JSON, a kind
 * outside the contract, no `seq`. Every field is read to its contract type with the contract's
 * absent value, so a daemon a version apart draws a thinner studio, never a crash.
 */
export function parseAdoptEvent(data: string): AdoptEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRaw(raw)) return null;
  const kind = raw.kind as AdoptEventKind;
  if (!ADOPT_EVENT_KINDS.includes(kind) || typeof raw.seq !== "number") return null;
  const seq = raw.seq;
  switch (kind) {
    case "adopt.progress":
    case "adopt.say":
      return { kind, seq, text: str(raw.text) };
    case "adopt.questions":
      return { kind, seq, round: num(raw.round), questions: list(raw.questions).map(questionOf).slice(0, 4) };
    case "adopt.slots":
      return { kind, seq, slots: list(raw.slots).map(slotOf) };
    case "adopt.lane": {
      const lane = laneOf(raw.lane);
      return lane === null ? null : { kind, seq, lane };
    }
    case "adopt.brief":
      return {
        kind,
        seq,
        rev: num(raw.rev),
        md: str(raw.md),
        command: str(raw.command),
        portals: isRaw(raw.portals)
          ? Object.fromEntries(Object.entries(raw.portals).map(([k, v]) => [k, str(v)]))
          : {},
        open_slot_ids: strings(raw.open_slot_ids),
      };
    case "adopt.clear":
      return { kind, seq, rev: num(raw.rev) };
    case "adopt.showcase":
      return {
        kind,
        seq,
        status: oneOf(raw.status, ["queued", "running", "done", "failed"], "queued"),
        turn: numOrNull(raw.turn),
        total: numOrNull(raw.total),
        trace: list(raw.trace).filter(isRaw),
        found_usd: numOrNull(raw.found_usd),
        detail: str(raw.detail),
      };
    case "adopt.usage":
      return {
        kind,
        seq,
        leg: str(raw.leg),
        model: str(raw.model),
        effort: str(raw.effort),
        ms: num(raw.ms),
        first_text_ms: numOrNull(raw.first_text_ms),
      };
    case "adopt.error":
      return { kind, seq, reason: str(raw.reason), detail: str(raw.detail) };
  }
}

/** Bytes as base64, in slices, so a 10 MB statement does not blow the argument limit of `apply`. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

/** Why a document cannot be handed over, in a sentence; "" when it can. */
export function documentRefusal(file: { name: string; size: number; type: string }): string {
  if (!DOCUMENT_MIMES.includes(file.type)) return `${file.name} is not a PDF, an image or a text file.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `${file.name} is over 10 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return "";
}
