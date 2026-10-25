/**
 * One trust verdict per tab: which rows of the origins table decide a tab's app, and what state
 * they put it in (README section 3.3; ADR 0063, 0065, 0100, 0105, 0106).
 *
 * Every reader of the table asks {@link trustOf} and folds its one answer in its own direction,
 * each fold a named function with its unread arm written down (authorization:
 * one-accessor-per-fold-direction): the gate's first-sight list counts an unread table's apps first
 * sight; `open_apps`, the contract check and `tabs_read` trust nothing from it; the switched-off
 * list still names every switched-off row it holds. A new reader picks a fold; it does not write a
 * sixth copy of the rule.
 */
import type { ContractTable } from "@/lib/contract";
import type { Tab } from "@/lib/ipc";
import { catalogIdOf, derivedIdOf } from "@/lib/manifest";
import type { OriginRow } from "@/lib/store";
import { originOf } from "@/modules/browser/model";
import type { OriginsState } from "@/stores/origins";
import type { TabTools } from "@/stores/tools";

/** What the gate's lists are read from: the origins table and, beside it, the accepted contracts. */
export type TrustTable = Pick<OriginsState, "records" | "known" | "loaded" | "problem"> & {
  /** Absent reads as nothing accepted: every tool of an enabled origin is a changed contract. */
  contracts?: ContractTable;
};

/** A tab's verdict. `rows` are the rows that apply to it; `web` is whether its web origin's is enabled. */
export interface Trust {
  origin: string;
  /** The catalog id its page claimed or derives (`catalogIdOf`), or `null`. */
  app: string | null;
  state: "unread" | "first-sight" | "trusted" | "off";
  rows: OriginRow[];
  web: boolean;
}

/**
 * The keys whose rows apply to a tab: its web origin's always, and the catalog-form row of its app
 * only when that app is the tab's own derived id. A page that claims a slug inherits nothing from
 * that slug's row (ADR 0065).
 */
export function rowKeysOf(origin: string, app: string | null): string[] {
  return app !== null && app === derivedIdOf(origin) ? [origin, `host:${app}`] : [origin];
}

/**
 * The rows of a table that loaded, read through `known` (the table's answer); `undefined` for an
 * unread table or a key it does not hold.
 */
export function rowOf(table: TrustTable, key: string): OriginRow | undefined {
  return table.loaded && table.problem === null && table.known.includes(key) ? table.records[key] : undefined;
}

/**
 * The verdict for `tab`. Any row held and switched off refuses - the web origin's, or the app's
 * catalog-form row even when the page only claims that slug (ADR 0106) - and it is read from
 * `records` itself, so a row the store holds before `known` lists it still refuses, as
 * {@link offRowsOf} already sends it. Otherwise an enabled applicable row trusts, and no applicable
 * row is first sight.
 */
export function trustOf(table: TrustTable, tab: Tab, byTab: Readonly<Record<number, TabTools>>): Trust {
  const origin = originOf(tab.url);
  const app = catalogIdOf(origin, byTab[tab.id]?.appId ?? null);
  const rows = rowKeysOf(origin, app)
    .map((k) => rowOf(table, k))
    .filter((r): r is OriginRow => r !== undefined);
  const off = [origin, `host:${app}`].some((k) => table.records[k]?.enabled === false);
  const state = !table.loaded || table.problem !== null ? "unread" : off ? "off" : rows.some((r) => r.enabled) ? "trusted" : "first-sight";
  return { origin, app, state, rows, web: rowOf(table, origin)?.enabled === true };
}

/** For `gated_origins`: no applicable row is first sight, and an unread table is first sight (fail closed). */
export function firstSightFold(trust: Trust): boolean {
  return trust.rows.length === 0;
}

/** For `open_apps` and the contract check: trusted only; first sight, off and unread trust nothing. */
export function trustFold(trust: Trust): boolean {
  return trust.state === "trusted";
}

/**
 * For `tabs_read` (ADR 0105): everything {@link trustFold} refuses, and a tab trusted only by its
 * catalog-form row too - only the web-origin row trusts a tab to be read. Unread trusts nothing.
 */
export function readFold(trust: Trust): boolean {
  return trustFold(trust) && trust.web;
}

/**
 * For `disabled_origins`: every switched-off row held, read or not, known or not - a list that
 * refuses must not shrink because the table is still loading.
 */
export function offRowsOf(records: Readonly<Record<string, OriginRow>>): string[] {
  return Object.keys(records).filter((k) => !records[k].enabled);
}
