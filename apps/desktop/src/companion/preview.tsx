/**
 * The companion's preview — ADR 0026, README section 3.5 (the preview harness).
 *
 * `preview.html?surface=athena&state=seal|tape|hear|slip|welcome|ledger|tab&theme=&scale=` renders
 * her window against a fixture with inert actions: no Tauri, no IPC, no daemon. She is drawn at
 * her named size (ADR 0026's table) inside a labelled neutral backdrop standing in for the
 * desktop, at a display scale of 100%, 125% or 150%, with her own rectangle outlined so the 8px
 * margin of shadow is visible. The outline and the label are the harness, not the product.
 *
 * Extra parameters, all defaulted: `fixture` picks any fixture by name (`slip many`, `ledger
 * record`, `tape done`; `state` is the plain one), `tab` picks the ledger's tab, `side` and
 * `valign` flip the orientation Rust would have chosen, `dock` makes a tab hang on the left or
 * right, `wall` is `checker` (transparent), `light` or `dark`, and `outline=0` hides the rectangle.
 */
import { useEffect, useState } from "react";

import { SIZES, isAthenaState, type Side, type Valign } from "@/lib/companion";
import { applyTheme, isTheme } from "@/stores/shell";

import { fixtureIds, fixtures } from "./fixtures";
import type { LedgerTab } from "./machine";
import type { CompanionModel } from "./model";
import CompanionView from "./views";

export interface PreviewQuery {
  fixture: string;
  tab: LedgerTab | null;
  side: Side | null;
  valign: Valign | null;
  dock: "left" | "right" | null;
  scale: number;
  wall: "checker" | "light" | "dark";
  outline: boolean;
  chrome: boolean;
}

export function readQuery(q: URLSearchParams): PreviewQuery {
  const state = q.get("state");
  const fixture = q.get("fixture") ?? (state && isAthenaState(state) ? state : "seal");
  const side = q.get("side");
  const valign = q.get("valign");
  const dock = q.get("dock");
  const tab = q.get("tab");
  const wall = q.get("wall");
  const scale = Number.parseFloat(q.get("scale") ?? "1");
  return {
    fixture: fixtureIds.includes(fixture) ? fixture : "seal",
    tab: tab === "talk" || tab === "record" || tab === "origins" ? tab : null,
    side: side === "left" || side === "right" ? side : null,
    valign: valign === "down" || valign === "up" ? valign : null,
    dock: dock === "left" || dock === "right" ? dock : null,
    scale: Number.isFinite(scale) && scale >= 0.5 && scale <= 3 ? scale : 1,
    wall: wall === "light" || wall === "dark" ? wall : "checker",
    outline: q.get("outline") !== "0",
    chrome: q.get("chrome") !== "0",
  };
}

/** The fixture with the query's overrides applied. Pure. */
export function modelFor(query: PreviewQuery): CompanionModel {
  const base = fixtures[query.fixture]();
  return {
    ...base,
    tab: query.tab ?? base.tab,
    side: query.side ?? base.side,
    valign: query.valign ?? base.valign,
    docked: query.dock ?? base.docked,
  };
}

export default function AthenaPreview() {
  const [query, setQuery] = useState<PreviewQuery>(() => readQuery(new URLSearchParams(window.location.search)));
  const theme = new URLSearchParams(window.location.search).get("theme");

  useEffect(() => {
    applyTheme(isTheme(theme) ? theme : "dark");
  }, [theme]);

  const set = (patch: Partial<PreviewQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const model = modelFor(query);
  const size = SIZES[model.form];
  const label = `${model.form} ${size.w}×${size.h}${query.scale !== 1 ? ` @${Math.round(query.scale * 100)}%` : ""}`;

  return (
    <div className="pv-stage" data-wall={query.wall}>
      <div className="pv-backdrop" aria-hidden="true" />
      <p className="pv-label">Preview, not product · her window alone on a neutral backdrop · every fixture is reachable state</p>
      {query.chrome ? (
        <aside className="pv-bar" aria-label="Preview controls">
          <label>
            fixture
            <select value={query.fixture} onChange={(e) => set({ fixture: e.target.value })}>
              {fixtureIds.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label>
            scale
            <select value={String(query.scale)} onChange={(e) => set({ scale: Number(e.target.value) })}>
              {[1, 1.25, 1.5].map((s) => (
                <option key={s} value={s}>
                  {Math.round(s * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label>
            backdrop
            <select value={query.wall} onChange={(e) => set({ wall: e.target.value as PreviewQuery["wall"] })}>
              <option value="checker">transparent</option>
              <option value="light">light wallpaper</option>
              <option value="dark">dark wallpaper</option>
            </select>
          </label>
        </aside>
      ) : null}
      <div
        className={`pv-win${query.outline ? " outline" : ""}`}
        style={{ width: size.w * query.scale, height: size.h * query.scale }}
        data-form={model.form}
      >
        <span className="pv-rl">{label}</span>
        <div style={{ zoom: query.scale, width: size.w, height: size.h }}>
          <CompanionView model={model} />
        </div>
      </div>
    </div>
  );
}
