/**
 * The page she is reading — ADR 0026 ("Who runs which store"), README section 3.3 and 3.4.
 *
 * Moved from the Panel module's `index.ts`, which ADR 0026 retired. The relay reports a page's
 * own tools; the class comes from the bridge's own gate.
 *
 * Not derived here and not invented here. `gate.js` is the surface half of README section 3.3 and
 * `tests/test_refusal_parity.py` pins its vocabulary to the Python's: the same derivation
 * `HostTool.default_class` makes, in the one file that is allowed to make it on a surface. It only
 * ever tightens: anything a page did not flag is `GATED`.
 */
import type { ToolRow } from "@/lib/api";
import type { BridgeTool } from "@/lib/bridge";
import { isMarkedHand, withHands } from "@/lib/hands";
import { catalogIdOf } from "@/lib/manifest";
import { originOf } from "@/modules/browser/model";
import type { GatedLists } from "@/stores/run";
import type { TabTools } from "@/stores/tools";
import { classify, flagsOf } from "@athena/bridge/gate";

/**
 * What one tab offers, as the gate will treat it: the page's own tools (tier 1) followed by the
 * generic hands the shell appends to every manifest (tier 2, ADR 0065). `gated` is what this
 * request will send: a first-sight app and a pinned tool are `GATED` whatever their flags say, so
 * the row shows that class and not the flag-derived one (ADR 0063, ADR 0066).
 */
export function toolRows(found: TabTools | undefined, gated: GatedLists = NO_TIGHTENING): ToolRow[] {
  if (!found?.tools) return [];
  const app = catalogIdOf(originOf(found.url), found.appId);
  const firstSight = app !== null && gated.gated_origins.includes(`host:${app}`);
  const row = (tool: BridgeTool, tier: 1 | 2): ToolRow => {
    const name = app ? `host.${app}.${tool.name}` : tool.name;
    const flags = flagsOf(tool);
    return {
      name,
      origin: app ? `host:${app}` : "",
      class: firstSight || gated.gated_tools.includes(name) ? "GATED" : classify(flags),
      tier,
      description: tool.description ?? "",
      // The declaration rides along for the card's words (ADR 0189); the gate's fallback for a tool
      // that declared nothing is not the app's word, so it is not passed off as one.
      ...(flags.basis === "unknown" ? {} : { reversible: flags.reversible, side_effects: flags.side_effects }),
    };
  };
  // The manifest's own list (`withHands`), so the rows and what the daemon is sent cannot disagree:
  // a page tool named like a hand keeps the page's, except `tabs_read`, which is the shell's alone.
  return withHands(found.tools).map((tool) => row(tool, isMarkedHand(tool) ? 2 : 1));
}

const NO_TIGHTENING: GatedLists = { gated_origins: [], gated_tools: [] };
