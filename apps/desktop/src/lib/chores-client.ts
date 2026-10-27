/**
 * When a chore comes due, over the daemon — ADR 0131, README section 3.5.
 *
 * The cadence a person sets on her case, the review a due occurrence opens and the notices to show
 * now (`CHORE_ROUTES` in `lib/adopt.ts`). Like `lib/adopt-client.ts`, `fetch` is an argument and the
 * endpoint is asked for at every call; a refusal is an `ApiError`, no daemon is one whose reason is
 * `offline`. Every field is read to its type with the contract's absent value. Nothing here sends a
 * turn: the review's "Open and prepare" is the desktop's, and the person presses send.
 */
import { daemonJson, globalFetch, type Endpoint, type FetchLike } from "@/lib/api";
import {
  CHORE_ROUTES,
  type Cadence,
  type CadenceLine,
  type CadenceReply,
  type CadenceRule,
  type ChoreReview,
  type DueNotice,
  type DueReply,
  type DueReview,
  type ReviewLine,
  type ReviewPortal,
} from "@/lib/adopt";

/** What the topic page and the notice watcher ask of the daemon about due chores. */
export interface ChoresClient {
  cadence(caseId: string): Promise<CadenceReply>;
  /** Set, change, pause (`enabled: false`) or resume her cadence. Only the person calls this. */
  setCadence(caseId: string, change: { rule?: CadenceRule; timezone?: string; enabled?: boolean }): Promise<CadenceReply>;
  review(caseId: string): Promise<DueReview | null>;
  /** `seen` stamps that the notice was shown; `prepare` and `skip` answer the review. */
  answer(caseId: string, dueAt: string, answer: "prepare" | "skip" | "seen"): Promise<DueReview | null>;
  due(): Promise<DueReply>;
}

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const raws = (v: unknown) => list(v).filter(isRaw);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  (all as readonly unknown[]).includes(v) ? (v as T) : d;
const texts = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(isRaw(v) ? v : {}).map(([k, x]) => [k, typeof x === "string" ? x : String(x)]));

export function ruleOf(raw: unknown): CadenceRule {
  const r = isRaw(raw) ? raw : {};
  return {
    kind: oneOf(r.kind, ["weekly", "monthly", "every_days"], "weekly"),
    weekday: num(r.weekday),
    day: num(r.day, 1),
    every_days: num(r.every_days),
    start: str(r.start),
    at: str(r.at) || "09:00",
  };
}

export function choreReviewOf(raw: unknown): ChoreReview | null {
  if (!isRaw(raw)) return null;
  return {
    due_at: str(raw.due_at),
    opened_at: str(raw.opened_at),
    missed: num(raw.missed),
    missed_at: list(raw.missed_at).filter((x): x is string => typeof x === "string"),
    delivered_at: str(raw.delivered_at),
    held_at: str(raw.held_at),
    answer: oneOf(raw.answer, ["", "prepare", "skip", "paused"], ""),
    answered_at: str(raw.answered_at),
    first_turn_id: str(raw.first_turn_id),
  };
}

const lineOf = (r: Raw): CadenceLine => ({ at: str(r.at), event: str(r.event), due_at: str(r.due_at), text: str(r.text) });

export function cadenceOf(raw: unknown): Cadence | null {
  if (!isRaw(raw)) return null;
  return {
    id: str(raw.id),
    case_id: str(raw.case_id),
    enabled: raw.enabled === true,
    rule: ruleOf(raw.rule),
    timezone: str(raw.timezone),
    next_run_at: str(raw.next_run_at),
    last_run_at: str(raw.last_run_at),
    created: str(raw.created),
    updated_at: str(raw.updated_at),
    review: choreReviewOf(raw.review),
    unanswered: num(raw.unanswered),
    log: raws(raw.log).map(lineOf),
    log_total: num(raw.log_total),
    schema: num(raw.schema, 1),
  };
}

export function dueReviewOf(raw: unknown): DueReview | null {
  if (!isRaw(raw)) return null;
  const lines: ReviewLine[] = raws(raw.lines).map((l) => ({
    kind: oneOf(l.kind, ["expired", "may_have_completed", "pending", "approved", "declined"], "approved"),
    action: str(l.action),
    params: texts(l.params),
    at: str(l.at),
    text: str(l.text),
  }));
  const portals: ReviewPortal[] = raws(raw.portals).map((p) => ({
    name: str(p.name),
    url: str(p.url),
    source: oneOf(p.source, ["playbook", "case", ""], ""),
  }));
  return {
    case_id: str(raw.case_id),
    playbook_id: str(raw.playbook_id),
    title: str(raw.title),
    command: str(raw.command),
    enabled: raw.enabled === true,
    rule_text: str(raw.rule_text),
    timezone: str(raw.timezone),
    next_run_at: str(raw.next_run_at),
    review: choreReviewOf(raw.review),
    unanswered: num(raw.unanswered),
    ask_slow: raw.ask_slow === true,
    last_run_at: str(raw.last_run_at),
    lines,
    lines_total: num(raw.lines_total, lines.length),
    lines_footer: str(raw.lines_footer),
    portals,
  };
}

function cadenceReplyOf(r: Raw): CadenceReply {
  const log = raws(r.log).map(lineOf);
  return {
    ok: true,
    case_id: str(r.case_id),
    cadence: cadenceOf(r.cadence),
    rule_text: str(r.rule_text),
    zone_note: str(r.zone_note),
    suggested: isRaw(r.suggested) ? ruleOf(r.suggested) : null,
    suggested_text: str(r.suggested_text),
    suggested_basis: str(r.suggested_basis),
    upcoming: list(r.upcoming).filter((x): x is string => typeof x === "string"),
    log,
    showing: num(r.showing, log.length),
    total: num(r.total, log.length),
    footer: str(r.footer),
  };
}

function dueReplyOf(r: Raw): DueReply {
  const notices: DueNotice[] = raws(r.notices).map((n) => ({
    case_id: str(n.case_id),
    playbook_id: str(n.playbook_id),
    title: str(n.title),
    due_at: str(n.due_at),
    missed: num(n.missed),
    ask_slow: n.ask_slow === true,
  }));
  const q = isRaw(r.quiet) ? r.quiet : {};
  return {
    ok: true,
    notices,
    held: num(r.held),
    quiet: { start: str(q.start), end: str(q.end), timezone: str(q.timezone), now: q.now === true, until: str(q.until) },
    ticked_at: str(r.ticked_at),
    showing: num(r.showing, notices.length),
    total: num(r.total, notices.length),
    footer: str(r.footer),
  };
}

export class ChoresApi implements ChoresClient {
  constructor(
    private readonly at: () => Endpoint | null,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  async cadence(caseId: string): Promise<CadenceReply> {
    return cadenceReplyOf(await this.json("GET", CHORE_ROUTES.cadence(caseId)));
  }

  async setCadence(
    caseId: string,
    change: { rule?: CadenceRule; timezone?: string; enabled?: boolean },
  ): Promise<CadenceReply> {
    return cadenceReplyOf(await this.json("POST", CHORE_ROUTES.cadence(caseId), change));
  }

  async review(caseId: string): Promise<DueReview | null> {
    return dueReviewOf((await this.json("GET", CHORE_ROUTES.review(caseId))).review);
  }

  async answer(caseId: string, dueAt: string, answer: "prepare" | "skip" | "seen"): Promise<DueReview | null> {
    const reply = await this.json("POST", CHORE_ROUTES.review(caseId), { due_at: dueAt, answer });
    return dueReviewOf(reply.review);
  }

  async due(): Promise<DueReply> {
    return dueReplyOf(await this.json("GET", CHORE_ROUTES.due));
  }

  private json(method: string, path: string, body?: unknown): Promise<Raw> {
    return daemonJson<Raw>(this.at(), this.fetchImpl, method, path, body);
  }
}
