/**
 * The Origins module's view-model — the `origins` table (README section 3.3) as a surface.
 *
 * This is the page that answers the question a per-app copilot never has to ask: *what has Athena
 * been given permission to do, across everything I have opened?* One row per origin — trust, when
 * it was first and last seen, how many tools it has, how many of them the user has ruled on —
 * and, in the detail, the per-tool overrides and the one act that undoes all of it.
 *
 * Three rules the shape keeps:
 *
 * - **Disable and Forget are different acts and stay different.** Disable is a reversible flag
 *   and keeps the overrides. Forget is a row delete: trust, overrides and both sightings go
 *   together and the next visit is a first sight again. The view asks once, in place.
 * - **An override may only tighten** (`@/lib/classes`, ADR 0018). The model carries the allowed
 *   set *and* the reason the set is empty, because a control that is simply absent is a fact the
 *   user cannot act on.
 * - **A declared class this app cannot see is `null`, not a guess.** Classes arrive with a live
 *   manifest, so an origin whose page is not open has stored overrides and no declared classes.
 *   Such a row says so and offers only "clear", rather than inventing a class to tighten from.
 */
import { allowedOverrides, effectiveClass, overrideIgnored, whyNoOverride } from "@/lib/classes";
import type { OriginRow as StoredOrigin, ToolClass } from "@/lib/store";
import { hostOf } from "@/lib/url";
import type { ToolRow } from "@/stores/run";

// -- the model -------------------------------------------------------------------------------

export interface OriginLine {
  origin: string;
  host: string;
  enabled: boolean;
  /** `YYYY-MM-DD`, or null when the row has never been written. */
  firstSeen: string | null;
  lastSeen: string | null;
  /** How many tools this origin currently offers, or null when its page is not open. */
  toolCount: number | null;
  overrideCount: number;
  /** True when this is the origin of the page in front of the user right now. */
  current: boolean;
}

/** One tool of one origin, with everything the picker beside it needs to be honest. */
export interface OverrideLine {
  tool: string;
  /** 1 the page's own, 2 a generic hand, 3 a connector — or null when the page is not open. */
  tier: 1 | 2 | 3 | null;
  /** What the manifest declared, or null when nothing live says. */
  declaredCls: ToolClass | null;
  overrideCls: ToolClass | null;
  /** What the gate will enforce, or null when the declared class is unknown. */
  effectiveCls: ToolClass | null;
  /** The classes the user may pin this at. Tighten-only, so often empty. */
  allowed: readonly ToolClass[];
  /** Why `allowed` is empty, or null when it is not. Shown, never implied. */
  lockedReason: string | null;
  /** A stored override the page's own manifest has since overtaken. The gate ignores it. */
  ignored: boolean;
}

export interface OriginDetail extends OriginLine {
  overrides: readonly OverrideLine[];
  /** True when no live manifest backs any of these rows. */
  offline: boolean;
}

export interface OriginsActions {
  /** Open one origin's detail, or close it. `null` closes. */
  select: (origin: string | null) => void;
  setEnabled: (origin: string, enabled: boolean) => void;
  setOverride: (origin: string, tool: string, cls: ToolClass | null) => void;
  /** The row delete. Trust, overrides and both sightings go with it. */
  forget: (origin: string) => void;
}

export interface OriginsModel {
  origins: readonly OriginLine[];
  selected: OriginDetail | null;
  /** True once the table has answered once. Before that, an empty list means nobody asked. */
  loaded: boolean;
  /** A sentence when the table could not be read, null when it could. Verbatim. */
  problem: string | null;
  trusted: number;
  actions: OriginsActions;
}

// -- the selector ----------------------------------------------------------------------------

export interface OriginsSources {
  /** Every origin the table holds, in the order it answered. The table is its own index. */
  known: readonly string[];
  records: Readonly<Record<string, StoredOrigin>>;
  loaded: boolean;
  problem: string | null;
  /** Every tool the run store currently knows, of every origin. The only source of a class. */
  tools: readonly ToolRow[];
  currentOrigin: string | null;
  selected: string | null;
  actions: OriginsActions;
}

export function selectOrigins(source: OriginsSources): OriginsModel {
  const origins = source.known
    .map((origin) => source.records[origin])
    .filter((record): record is StoredOrigin => Boolean(record))
    .map((record) => line(record, source));

  return {
    origins,
    selected: source.selected ? detail(source.selected, source) : null,
    loaded: source.loaded,
    problem: source.problem,
    trusted: origins.filter((o) => o.enabled).length,
    actions: source.actions,
  };
}

function line(record: StoredOrigin, source: OriginsSources): OriginLine {
  const tools = source.tools.filter((t) => t.origin === record.origin);
  return {
    origin: record.origin,
    host: hostOf(record.origin),
    enabled: record.enabled,
    firstSeen: dayOf(record.first_seen),
    lastSeen: dayOf(record.last_seen),
    toolCount: tools.length > 0 ? tools.length : null,
    overrideCount: Object.keys(record.overrides ?? {}).length,
    current: record.origin === source.currentOrigin,
  };
}

/**
 * One origin's detail: every tool its page currently offers, then every tool the user has ruled
 * on that the page is not offering right now. The second set is the one a list built from the
 * live manifest alone would lose — and it is exactly the set a user comes to this page to undo.
 */
function detail(origin: string, source: OriginsSources): OriginDetail | null {
  const record = source.records[origin];
  if (!record) return null;

  const overrides = record.overrides ?? {};
  const live = source.tools.filter((t) => t.origin === origin);
  const rows: OverrideLine[] = live.map((tool) =>
    overrideLine(tool.name, tool.tier, tool.declaredCls, overrides[tool.name] ?? null),
  );
  const seen = new Set(live.map((t) => t.name));
  for (const [tool, cls] of Object.entries(overrides)) {
    if (!seen.has(tool)) rows.push(overrideLine(tool, null, null, cls));
  }

  return {
    ...line(record, source),
    overrides: rows,
    offline: live.length === 0,
  };
}

function overrideLine(
  tool: string,
  tier: 1 | 2 | 3 | null,
  declared: ToolClass | null,
  override: ToolClass | null,
): OverrideLine {
  return {
    tool,
    tier,
    declaredCls: declared,
    overrideCls: override,
    effectiveCls: declared ? effectiveClass(declared, override) : null,
    allowed: allowedOverrides(declared),
    lockedReason: whyNoOverride(declared),
    ignored: declared ? overrideIgnored(declared, override) : false,
  };
}

/**
 * The day part of a stored instant, verbatim.
 *
 * Not `toLocaleDateString`: these sit in a column, and a format that changes with the machine's
 * locale changes the column's width between two users looking at the same table. The rows are
 * written as ISO by the store, so the first ten characters are the day and nothing is parsed.
 */
export function dayOf(stored: string): string | null {
  const day = stored.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Fixtures and any variant that needs a set that does nothing. */
export const INERT_ACTIONS: OriginsActions = {
  select: () => {},
  setEnabled: () => {},
  setOverride: () => {},
  forget: () => {},
};
