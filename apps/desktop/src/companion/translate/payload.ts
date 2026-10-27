/**
 * Reading a tool's answer - the JSON half of the translator. `readJson` is the one place a tool's
 * output is parsed; everything after it walks a `Json` value and composes a title, a line under it
 * and the detail one level down (a table, a comparison, a letter, facts or a quote).
 */
import {
  AGE_KEY,
  MONEY_KEY,
  NAME_KEYS,
  NOTE_KEY,
  PREFIX_NOUN,
  READ_VERBS,
  SKIP_KEY,
  appSuffix,
  article,
  cap,
  dateText,
  humanKey,
  ISO_DAY,
  ISO_TIME,
  isObj,
  money,
  objectPhrase,
  past,
  plural,
  singular,
  tidyId,
  type Json,
  type JsonObject,
  type ToolName,
} from "./words";

/** The one door: a tool's output text as JSON, or `undefined` when it is not JSON. */
export function readJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

export interface Fact {
  k: string;
  v: string;
}

export interface TableCol {
  key: string;
  label: string;
  align: "l" | "r";
  num?: true;
  id?: true;
}

export interface TableRow {
  cells: string[];
  note: Fact | null;
  hint: string | null;
  label: string;
}

export interface CompareRow {
  key: string;
  label: string;
  money: boolean;
  values: string[];
  delta: number;
}

/** The content one level below a message. */
export type Detail =
  | { kind: "none" }
  | { kind: "table"; cols: TableCol[]; rows: TableRow[] }
  | { kind: "compare"; cols: string[]; rows: CompareRow[] }
  | { kind: "letter"; to: string; subject: string; body: string; cut: boolean }
  | { kind: "facts"; rows: Fact[] }
  | { kind: "quote"; text: string; meta: string };

/** Which step last read a record, and when: the entry's stamp and the tool's name. */
export interface Seen {
  at: string;
  tool: string;
}

/** What the turn has already shown, so a later line can name people and drafts. */
export interface TurnContext {
  byId: Record<string, JsonObject>;
  /** Per id in `byId`, the step that last read it: what a card about it stands on, and how old that is. */
  seen: Record<string, Seen>;
  byEmail: Record<string, { who: string; contact: string | null }>;
  drafts: Record<string, JsonObject>;
  proposals: Record<string, JsonObject>;
}

export const EMPTY_CONTEXT: TurnContext = { byId: {}, seen: {}, byEmail: {}, drafts: {}, proposals: {} };

const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);
const num = (v: Json | undefined): number | null => (typeof v === "number" ? v : null);
const scalar = (v: Json | undefined): v is null | string | number | boolean =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function nameKeyOf(obj: JsonObject): string | null {
  for (const k of NAME_KEYS) if (str(obj[k])) return k;
  return null;
}

export function labelOf(obj: JsonObject): string {
  const k = nameKeyOf(obj);
  const v = k ? str(obj[k]) : null;
  return v ? tidyId(v) : "";
}

/** The array the payload is mostly about: `items`, or the longest array of objects. */
function mainArray(p: Json): { key: string; rows: JsonObject[] } | null {
  if (!isObj(p)) return null;
  const items = p.items;
  if (Array.isArray(items)) return items.every(isObj) ? { key: "items", rows: items as JsonObject[] } : null;
  let best: { key: string; rows: JsonObject[] } | null = null;
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v) && v.length && v.every(isObj) && (!best || v.length > best.rows.length)) best = { key: k, rows: v as JsonObject[] };
  }
  return best;
}

/** `{account:{...}}`, `{task:{...}}`, `{draft:{...}}`: one record beside the ok and message flags. */
function wrapped(p: Json): { key: string; obj: JsonObject } | null {
  if (!isObj(p)) return null;
  const keys = Object.keys(p).filter((k) => isObj(p[k]) && !/^(screen|studio|meta)$/.test(k));
  const key = keys.length === 1 ? keys[0]! : null;
  const obj = key ? p[key] : undefined;
  return key && isObj(obj) ? { key, obj } : null;
}

function fmtValue(k: string, v: Json | undefined): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (MONEY_KEY.test(k)) return money(v);
    if (AGE_KEY.test(k)) return v + (v === 1 ? " day" : " days");
    if (/ratio$/.test(k)) return Math.round(v * 100) + "%";
    return v.toLocaleString("en-US");
  }
  if (typeof v === "string") return ISO_DAY.test(v) || ISO_TIME.test(v) ? dateText(v) : tidyId(v);
  if (Array.isArray(v)) return v.length + " " + plural(v.length, "item");
  return "";
}

export function factsOf(obj: JsonObject, skip: ReadonlySet<string> = new Set()): Fact[] {
  const rows: Fact[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (SKIP_KEY.test(k) || skip.has(k)) continue;
    if (scalar(v)) {
      if (v !== null) rows.push({ k: humanKey(k), v: fmtValue(k, v) });
    } else if (Array.isArray(v)) {
      if (!v.length) rows.push({ k: humanKey(k), v: "none" });
      else if (v.every(isObj)) {
        const names = (v as JsonObject[]).map(labelOf).filter(Boolean).join(", ");
        rows.push({ k: humanKey(k), v: names || v.length + " " + plural(v.length, "item") });
      } else rows.push({ k: humanKey(k), v: v.join(", ") });
    }
  }
  return rows;
}

function pickMoneyKey(rows: JsonObject[]): string | null {
  for (const k of ["balance", "amount"]) if (rows.every((r) => num(r[k]) !== null)) return k;
  return Object.keys(rows[0] ?? {}).find((k) => MONEY_KEY.test(k) && rows.every((r) => num(r[k]) !== null)) ?? null;
}

const pickAgeKey = (rows: JsonObject[]): string | null =>
  Object.keys(rows[0] ?? {}).find((k) => AGE_KEY.test(k) && rows.every((r) => num(r[k]) !== null)) ?? null;

function nounForRows(rows: JsonObject[], t: ToolName): string {
  const id = str(rows[0]?.id);
  const prefix = id ? /^([a-z]+)_/.exec(id) : null;
  const noun = prefix ? PREFIX_NOUN[prefix[1]!] : undefined;
  return noun ?? singular(t.object || "item");
}

const sumOf = (rows: JsonObject[], key: string): number => rows.reduce((s, r) => s + (num(r[key]) ?? 0), 0);
const days = (n: number): string => (n === 1 ? "1 day" : `${n} days`);

function tableDetail(rows: JsonObject[], t: ToolName): Extract<Detail, { kind: "table" }> & { moneyKey: string | null; ageKey: string | null } {
  const first = rows[0]!;
  const nameKey = nameKeyOf(first) === "id" ? "id" : rows.every((r) => str(r.client) !== null) ? "client" : nameKeyOf(first);
  const moneyKey = pickMoneyKey(rows);
  const ageKey = pickAgeKey(rows);
  const idKey = ["number", "id"].find((k) => k !== nameKey && rows.every((r) => str(r[k]) !== null));
  const stageKey = ["stage", "state", "status"].find(
    (k) => rows.every((r) => str(r[k]) !== null) && new Set(rows.map((r) => r[k])).size > 1,
  );
  const cols: TableCol[] = [];
  if (nameKey) cols.push({ key: nameKey, label: humanKey(nameKey), align: "l" });
  if (idKey) cols.push({ key: idKey, label: idKey === "number" ? nounForRows(rows, t) : "ref", align: "l", id: true });
  if (stageKey) cols.push({ key: stageKey, label: humanKey(stageKey), align: "l" });
  if (moneyKey) cols.push({ key: moneyKey, label: humanKey(moneyKey), align: "r", num: true });
  if (ageKey) cols.push({ key: ageKey, label: humanKey(ageKey), align: "r", num: true });
  const noteKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => NOTE_KEY.test(k));
  const cell = (r: JsonObject, key: string): string => {
    const v = r[key];
    if ((key === "number" || key === "id") && typeof v === "string") return tidyId(v);
    if (key === ageKey && typeof v === "number") return days(v);
    return fmtValue(key, v);
  };
  return {
    kind: "table",
    cols,
    rows: rows.map((r) => {
      const noted = noteKeys.find((k) => !!r[k]);
      return {
        cells: cols.map((c) => cell(r, c.key)),
        note: noted ? { k: humanKey(noted), v: String(r[noted]) } : null,
        hint: str(r.contact_email),
        label: labelOf(r),
      };
    }),
    moneyKey,
    ageKey,
  };
}

/** Two or more records sharing keys (periods): keys by records, with the change between the first two. */
function compareDetail(rows: JsonObject[]): Extract<Detail, { kind: "compare" }> | null {
  const first = rows[0];
  const second = rows[1];
  if (!first || !second) return null;
  const keys = Object.keys(first);
  const labelKey = keys.find((k) => str(first[k]) !== null && new Set(rows.map((r) => r[k])).size === rows.length);
  if (!labelKey) return null;
  const numKeys = keys.filter((k) => k !== labelKey && rows.every((r) => num(r[k]) !== null));
  if (!numKeys.length) return null;
  return {
    kind: "compare",
    cols: rows.map((r) => String(r[labelKey])),
    rows: numKeys.map((k) => {
      const a = num(first[k]) ?? 0;
      const b = num(second[k]) ?? 0;
      return {
        key: k,
        label: cap(humanKey(k)),
        money: MONEY_KEY.test(k),
        values: rows.map((r) => fmtValue(k, r[k])),
        delta: b > 0 ? (a - b) / b : a > 0 ? Infinity : 0,
      };
    }),
  };
}

const pct = (d: number): string => (d === Infinity ? "new" : (d >= 0 ? "+" : "-") + Math.round(Math.abs(d) * 100) + "%");

export function tidyContact(email: string, ctx: TurnContext): string {
  if (!email) return "";
  const known = ctx.byEmail[email];
  return known ? `${known.who} (${email})` : email;
}

/** What one tool answer reads as. */
export interface Composed {
  title: string;
  sub: string;
  detail: Detail;
  tone: "ok" | "fail";
}

function composeList(t: ToolName, p: JsonObject | Json, rows: JsonObject[], key: string): Composed {
  const sfx = appSuffix(t);
  // The kit's page with nothing on it (`{items: [], showing: 0, of: 0}`): a read that found nothing.
  if (!rows.length) return { title: `${past(t.verb)} ${objectPhrase(t, true)}${sfx}`.replace(/\s+/g, " ").trim(), sub: "Nothing found.", detail: { kind: "none" }, tone: "ok" };
  const cmp = key === "items" ? null : compareDetail(rows);
  if (cmp) {
    const rank = (r: CompareRow) => (r.delta === Infinity ? 1e9 : Math.abs(r.delta));
    const ranked = cmp.rows.filter((r) => r.money && r.delta !== 0).sort((a, b) => rank(b) - rank(a));
    const moves = ranked
      .slice(0, 3)
      .map((r) => `${r.label.toLowerCase()} ${r.values[0]}${r.delta === Infinity ? ` (was ${r.values[1]})` : ` (${pct(r.delta)})`}`);
    return {
      title: `${past(t.verb)} ${objectPhrase(t, true)}${sfx}, ${cmp.cols[0]} against ${cmp.cols[1]}`,
      sub: moves.length ? `Biggest moves: ${moves.join(", ")}.` : "No change between the two.",
      detail: cmp,
      tone: "ok",
    };
  }
  const noun = nounForRows(rows, t);
  const filterWord = isObj(p) ? str(p.filter) : null;
  const filter = filterWord && filterWord !== "all" ? filterWord + " " : "";
  const of = isObj(p) ? num(p.of) : null;
  const total = of ?? rows.length;
  const countText = total > rows.length ? `${rows.length} of ${total}` : String(rows.length);
  const det = tableDetail(rows, t);
  const bits: string[] = [];
  if (det.moneyKey) bits.push(`${money(sumOf(rows, det.moneyKey))} ${det.moneyKey === "amount" ? "in total" : humanKey(det.moneyKey)}`);
  if (det.ageKey) {
    const ageKey = det.ageKey;
    const worst = rows.reduce((a, b) => ((num(b[ageKey]) ?? 0) > (num(a[ageKey]) ?? 0) ? b : a));
    bits.push(`longest: ${labelOf(worst)}, ${num(worst[ageKey])} days ${ageKey.replace(/^days_/, "")}`);
  }
  const flagged = rows.filter((r) => Object.keys(r).some((k) => NOTE_KEY.test(k) && !!r[k]));
  if (flagged.length) bits.push(`${flagged.length} with a note`);
  const { kind, cols, rows: tableRows } = det;
  return {
    title: `${past(t.verb)} ${countText} ${filter}${plural(total > rows.length ? 2 : rows.length, noun)}${sfx}`,
    sub: bits.join(" · "),
    detail: { kind, cols, rows: tableRows },
    tone: "ok",
  };
}

function composeRecord(t: ToolName, p: JsonObject, key: string, e: JsonObject, ctx: TurnContext): Composed {
  const sfx = appSuffix(t);
  const body = str(e.body);
  if (body !== null && (e.to || e.subject)) {
    const to = str(e.to) ?? "";
    const message = str(p.message);
    return {
      title: message ? message.replace(/\.$/, "") + sfx : `${past(t.verb)} ${article(key)} ${key}${sfx}`,
      sub: `To ${tidyContact(to, ctx)}: “${str(e.subject) || "no subject"}”`,
      detail: { kind: "letter", to: tidyContact(to, ctx), subject: str(e.subject) ?? "", body, cut: /\.\.\.\s*$/.test(body) },
      tone: "ok",
    };
  }
  const noun = str(e.type) ?? key;
  const label = labelOf(e);
  const reads = READ_VERBS.has(t.verb);
  const sum = str(e.summary) ?? str(e.title);
  const facts = factsOf(e, new Set(["name", "title", "summary", "type"]));
  const sub = reads
    ? facts.filter((f) => f.k !== "contacts").slice(0, 3).map((f) => `${f.k} ${f.v}`).join(" · ")
    : [sum ? `“${sum}”` : "", ...facts.filter((f) => /date|due/.test(f.k)).map((f) => `${f.k} ${f.v}`)].filter(Boolean).join(" · ");
  return {
    title: (reads ? `${past(t.verb)} ${noun} ${label}${sfx}` : `${past(t.verb)} ${article(noun)} ${noun}${sfx}`).replace(/\s+/g, " "),
    sub,
    detail: { kind: "facts", rows: factsOf(e).filter((f) => f.k !== "id") },
    tone: "ok",
  };
}

function withFacts(obj: JsonObject): Detail {
  const rows = factsOf(obj);
  return rows.length ? { kind: "facts", rows } : { kind: "none" };
}

/** One tool answer, from its parsed output (or its raw text when it was not JSON). */
export function composeTool(t: ToolName, p: Json, ok: boolean, ctx: TurnContext): Composed {
  const sfx = appSuffix(t);
  if (isObj(p) && p.ok === false) {
    const error = str(p.error);
    const reason = error ? error.replace(/\b([a-z]+)_at\b/g, "$1 date").replace(/\b([a-z]+)_([a-z_]+)\b/g, (m) => m.replace(/_/g, " ")) : "";
    return {
      title: `Could not ${t.verb} ${objectPhrase(t, true)}${sfx}`.replace(/\s+/g, " "),
      sub: reason ? cap(reason) : "The app reported a problem.",
      detail: { kind: "none" },
      tone: "fail",
    };
  }
  // A call that failed in words rather than JSON (a thrown error, "refused"): it did not happen, so
  // it never reads in the past tense of what it would have done.
  if (!ok && (typeof p === "string" || p === null)) {
    const said = typeof p === "string" ? p.trim() : "";
    return {
      title: `Could not ${t.verb} ${objectPhrase(t, true)}${sfx}`.replace(/\s+/g, " ").trim(),
      sub: said ? cap(said.length > 140 ? said.slice(0, 137) + "..." : said) : "The app reported a problem.",
      detail: { kind: "none" },
      tone: "fail",
    };
  }
  const tone = ok ? "ok" : "fail";
  const list = mainArray(p);
  if (list) return { ...composeList(t, p, list.rows, list.key), tone };
  if (isObj(p) && isObj(p.tab) && typeof p.text === "string") {
    const chars = num(p.chars) ?? p.text.length;
    return {
      title: `${past(t.verb)} your “${str(p.tab.title) ?? "other"}” tab`,
      sub: `${chars.toLocaleString("en-US")} characters${p.truncated ? ", only the start was kept" : ""}`,
      detail: { kind: "quote", text: p.text, meta: str(p.tab.origin) ?? "" },
      tone,
    };
  }
  const wrap = wrapped(p);
  if (wrap && isObj(p)) return { ...composeRecord(t, p, wrap.key, wrap.obj, ctx), tone };
  if (isObj(p) && typeof p.message === "string") {
    return { title: p.message.replace(/\.$/, "") + sfx, sub: "", detail: withFacts(p), tone };
  }
  // The generic fallback: the humanised verb, then whatever counts, ids and flags the JSON carries.
  const title = `${past(t.verb)} ${objectPhrase(t, true)}${sfx}`.replace(/\s+/g, " ").trim();
  if (isObj(p)) {
    const bits: string[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (Array.isArray(v)) bits.push(`${v.length} ${plural(v.length, humanKey(singular(k)))}`);
      else if (scalar(v) && v !== null && k !== "ok" && bits.length < 4) bits.push(`${humanKey(k)} ${fmtValue(k, v)}`);
    }
    return { title, sub: bits.join(" · "), detail: withFacts(p), tone };
  }
  if (Array.isArray(p)) return { title, sub: `${p.length} ${plural(p.length, "item")}`, detail: { kind: "none" }, tone };
  if (typeof p === "string") return { title, sub: p.length > 140 ? p.slice(0, 137) + "..." : p, detail: { kind: "none" }, tone };
  return { title, sub: "", detail: { kind: "none" }, tone };
}
