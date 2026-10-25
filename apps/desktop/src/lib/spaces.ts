/**
 * Projects, over the daemon — README section 3.5, ADR 0225.
 *
 * A person's word is **Project**; the wire's is **space**, because `proj_`, `project_id` and
 * `frame.project` already name a chore case (ADR 0123). A space pairs registered apps, links chores
 * and carries the brief Athena reads every turn inside it, and the memory written there is filed
 * under it. Outside every space is **core**, and core's absent value is the empty string, never
 * `null`. Like `lib/chores-client.ts`, `fetch` is an argument and the endpoint is asked for at
 * every call; a refusal is an `ApiError`, no daemon is one whose reason is `offline`.
 */
import { ApiError, globalFetch, type Endpoint, type FetchLike } from "@/lib/api";

/** The active space when none is: Athena's core. */
export const CORE = "";

/** The depth item that names core (`projects/core`); never a space id. */
export const CORE_ITEM = "core";

/** The caps the daemon validates, mirrored so a form can count down to them. */
export const SPACE_CAPS = { name: 60, brief: 1600, apps: 24 } as const;

export type SpaceMemoryKind = "episode" | "fact" | "procedural";
export const SPACE_MEMORY_KINDS: readonly SpaceMemoryKind[] = ["episode", "fact", "procedural"];

export interface SpaceCounts {
  episodes: number;
  facts: number;
  procedurals: number;
  chores: number;
}

export interface Space {
  id: string;
  name: string;
  brief: string;
  /** Web origins (`https://host[:port]`), the apps paired into it. */
  apps: readonly string[];
  /** 0..359: the hue its orbit and pill are drawn in. */
  hue: number;
  created: string;
  updated: string;
}

export interface SpaceSummary extends Space {
  counts: SpaceCounts;
}

/** What an erase took with it. Linked chores are not erased: they return to core. */
export interface SpaceErased {
  id: string;
  episodes: number;
  facts: number;
  procedurals: number;
  chores_unlinked: number;
}

export interface SpaceMemoryRow {
  id: string;
  kind: SpaceMemoryKind;
  /** One quoted, capped line (at most 240 chars). */
  line: string;
  created: string;
}

export interface SpaceMemoryPage {
  rows: readonly SpaceMemoryRow[];
  showing: number;
  total: number;
}

export interface SpaceInput {
  name: string;
  brief?: string;
  apps?: readonly string[];
  hue?: number;
}

export type SpacePatch = Partial<SpaceInput>;

export const SPACE_ROUTES = {
  list: "/spaces",
  one: (id: string) => `/spaces/${encodeURIComponent(id)}`,
  /** `id` may be `core` (CORE_ITEM). */
  memory: (id: string) => `/spaces/${encodeURIComponent(id)}/memory`,
  promote: (id: string, memId: string) => `/spaces/${encodeURIComponent(id)}/memory/${encodeURIComponent(memId)}/core`,
  /** Link or unlink a chore case; `space_id: ""` returns it to core. */
  caseSpace: (caseId: string) => `/adopt/cases/${encodeURIComponent(caseId)}/space`,
} as const;

/** What the Projects scene, the pill and the chips ask of the daemon. */
export interface SpacesClient {
  list(): Promise<SpaceSummary[]>;
  get(id: string): Promise<SpaceSummary>;
  create(input: SpaceInput): Promise<SpaceSummary>;
  update(id: string, patch: SpacePatch): Promise<SpaceSummary>;
  erase(id: string): Promise<SpaceErased>;
  memory(id: string, kind?: SpaceMemoryKind, limit?: number): Promise<SpaceMemoryPage>;
  /** Lift one fact or procedural out of its space into core. */
  promote(id: string, memId: string): Promise<{ id: string; kind: SpaceMemoryKind }>;
  /** Link a chore case to a space, or `CORE` to unlink it. Answers the case's new space id. */
  linkCase(caseId: string, spaceId: string): Promise<string>;
}

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  (all as readonly unknown[]).includes(v) ? (v as T) : d;

export function countsOf(raw: unknown): SpaceCounts {
  const r = isRaw(raw) ? raw : {};
  return { episodes: num(r.episodes), facts: num(r.facts), procedurals: num(r.procedurals), chores: num(r.chores) };
}

/** A summary read to its types, or null when it has no id. */
export function spaceOf(raw: unknown): SpaceSummary | null {
  if (!isRaw(raw) || str(raw.id) === "") return null;
  return {
    id: str(raw.id),
    name: str(raw.name),
    brief: str(raw.brief),
    apps: list(raw.apps).filter((x): x is string => typeof x === "string"),
    hue: Math.min(359, Math.max(0, Math.round(num(raw.hue)))),
    created: str(raw.created),
    updated: str(raw.updated),
    counts: countsOf(raw.counts),
  };
}

export function erasedOf(raw: unknown): SpaceErased {
  const r = isRaw(raw) ? raw : {};
  return {
    id: str(r.id),
    episodes: num(r.episodes),
    facts: num(r.facts),
    procedurals: num(r.procedurals),
    chores_unlinked: num(r.chores_unlinked),
  };
}

export function memoryPageOf(raw: unknown): SpaceMemoryPage {
  const r = isRaw(raw) ? raw : {};
  const rows = list(r.rows)
    .filter(isRaw)
    .filter((x) => str(x.id) !== "")
    .map((x) => ({
      id: str(x.id),
      kind: oneOf(x.kind, SPACE_MEMORY_KINDS, "episode"),
      line: str(x.line),
      created: str(x.created),
    }));
  return { rows, showing: num(r.showing, rows.length), total: num(r.total, rows.length) };
}

const offline = (detail: string) => new ApiError(0, "offline", detail);

const missing = (what: string) => new ApiError(502, "bad_reply", `the daemon answered no ${what}`);

export class SpacesApi implements SpacesClient {
  constructor(
    private readonly at: () => Endpoint | null,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async list(): Promise<SpaceSummary[]> {
    const reply = await this.json("GET", SPACE_ROUTES.list);
    return list(reply.spaces)
      .map(spaceOf)
      .filter((s): s is SpaceSummary => s !== null);
  }

  async get(id: string): Promise<SpaceSummary> {
    return spaceOf(await this.json("GET", SPACE_ROUTES.one(id))) ?? Promise.reject(missing("space"));
  }

  async create(input: SpaceInput): Promise<SpaceSummary> {
    return spaceOf(await this.json("POST", SPACE_ROUTES.list, input)) ?? Promise.reject(missing("space"));
  }

  async update(id: string, patch: SpacePatch): Promise<SpaceSummary> {
    return spaceOf(await this.json("POST", SPACE_ROUTES.one(id), patch)) ?? Promise.reject(missing("space"));
  }

  async erase(id: string): Promise<SpaceErased> {
    return erasedOf(await this.json("DELETE", SPACE_ROUTES.one(id)));
  }

  async memory(id: string, kind?: SpaceMemoryKind, limit?: number): Promise<SpaceMemoryPage> {
    const query = new URLSearchParams();
    if (kind) query.set("kind", kind);
    if (limit !== undefined) query.set("limit", String(limit));
    const qs = query.toString();
    return memoryPageOf(await this.json("GET", `${SPACE_ROUTES.memory(id)}${qs ? `?${qs}` : ""}`));
  }

  async promote(id: string, memId: string): Promise<{ id: string; kind: SpaceMemoryKind }> {
    const reply = await this.json("POST", SPACE_ROUTES.promote(id, memId));
    return { id: str(reply.id), kind: oneOf(reply.kind, SPACE_MEMORY_KINDS, "fact") };
  }

  async linkCase(caseId: string, spaceId: string): Promise<string> {
    const reply = await this.json("POST", SPACE_ROUTES.caseSpace(caseId), { space_id: spaceId });
    return str(reply.space_id);
  }

  private async json(method: string, path: string, body?: unknown): Promise<Raw> {
    const at = this.at();
    if (at === null) throw offline("The daemon is not running.");
    let response: Response;
    try {
      response = await this.fetchImpl(`${at.url}${path}`, {
        method,
        headers: { "X-Athena-Token": at.token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw offline(error instanceof Error ? error.message : String(error));
    }
    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      // Not JSON: the status is the answer.
    }
    const r = isRaw(payload) ? payload : {};
    if (!response.ok) throw new ApiError(response.status, str(r.reason) || "unknown", str(r.detail));
    return r;
  }
}
