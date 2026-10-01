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
import type { TabTools } from "@/stores/tools";
// @ts-expect-error - gate.js is plain JavaScript with a .d.ts that does not cover these two.
import { classify, flagsOf } from "@athena/bridge/gate";

export function toolRows(found: TabTools | undefined): ToolRow[] {
  if (!found?.tools) return [];
  return found.tools.map((tool) => ({
    name: found.appId ? `host.${found.appId}.${tool.name}` : tool.name,
    origin: found.appId ? `host:${found.appId}` : "",
    class: classify(flagsOf(tool)) as ToolRow["class"],
    tier: 1,
    description: tool.description ?? "",
  }));
}

/** A tab's web origin, or `null` when its address is not a URL. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
