/**
 * The bell in a plain browser — README section 3.5, ADR 0087.
 *
 * `preview.html?scene=bell` draws every pose side by side over the stage's water, with the
 * reach a real build would have (nine apps and accounts, five lit). `?pose=asking` shows one large.
 * The gate drives it: `pnpm perf:bell` changes poses and the lean for several seconds and then
 * holds that nothing asks the browser for a frame. `?calm=1` renders it under Calm.
 */
import { useEffect, useMemo, useState } from "react";

import { applyMotion } from "@/lib/motion";

import Bell, { type Reach } from "./Bell";
import { POSES, type Pose } from "./pose";

const REACH: Reach[] = [
  { id: "ledgerbox", lit: true },
  { id: "inbox", lit: true },
  { id: "gate-docs", lit: true },
  { id: "crm", lit: false },
  { id: "calendar", lit: false },
  { id: "gmail", lit: true },
  { id: "notion", lit: true },
  { id: "hirelane", lit: false },
  { id: "atlas", lit: false },
];

export default function BellPreview() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const calm = q.get("calm") === "1";
  const one = q.get("pose") as Pose | null;
  const [lean, setLean] = useState(0);
  useEffect(() => applyMotion(calm ? "calm" : "full"), [calm]);

  const poses = one && POSES.includes(one) ? [one] : POSES;
  return (
    <div className="bell-preview" style={{ background: "var(--depth-1)", minHeight: "100vh", padding: 24 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        {[-1, 0, 1].map((l) => (
          <button key={l} type="button" data-lean={l} onClick={() => setLean(l)}>
            lean {l}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {poses.map((p) => (
          <figure key={p} data-pose-card={p} style={{ margin: 0, textAlign: "center", color: "var(--foreground)" }}>
            <Bell pose={p} reach={REACH} lean={lean} size={one ? 520 : 300} label="Athena" />
            <figcaption>{p}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
