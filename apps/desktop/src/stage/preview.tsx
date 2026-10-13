/**
 * The stage in a plain browser — README section 3.5, ADR 0087.
 *
 * `preview.html?scene=stage` renders the real `Stage` over placeholder scenes, with no Tauri, no
 * IPC and no daemon, driven by the pure depth reducer. It is how the stage's motion is looked at
 * and what `pnpm perf:stage` drives. The placeholder scenes are deliberately not empty: each holds
 * a field of cards with shadows and gradients, because a gate that measures moves over a blank
 * page measures nothing.
 *
 * `?calm=1` renders it under Calm; `?at=#/apps/host-1` opens at a depth.
 */
import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  INITIAL,
  ROOTS,
  ROOT_LABEL,
  crumbs,
  parseHash,
  reduce,
  type DepthState,
  type Path,
} from "@/depth/model";
import { applyMotion } from "@/lib/motion";

import Stage from "./Stage";
import "./preview.css";

const ITEMS: Record<string, string[]> = {
  apps: ["host-1", "host-2", "mail"],
  chores: ["flight-compensation", "carrier-refunds"],
  accounts: ["gmail", "notion"],
  voice: ["studio", "settings"],
  mind: ["engine", "brain", "look", "data", "mic"],
};

const SUBS: Record<string, { kind: string; arg?: string; label: string }[]> = {
  apps: [
    { kind: "page", label: "Open the page" },
    { kind: "tool", arg: "page_read", label: "page_read" },
  ],
  chores: [{ kind: "run", arg: "1", label: "Replay a run" }],
  accounts: [{ kind: "allowlist", label: "Allow-list" }],
};

function go(path: Path): Path {
  return path;
}

function Placeholder({ path, onGo }: { path: Path; onGo: (to: Path) => void }) {
  const title = crumbs(path).at(-1)!.label;
  const children: { label: string; to: Path; key: string }[] = [];
  if (path.root === null) {
    for (const r of ROOTS) children.push({ label: ROOT_LABEL[r], to: { root: r }, key: r });
  } else if (path.item === undefined) {
    for (const item of ITEMS[path.root] ?? []) children.push({ label: item, to: { root: path.root, item }, key: item });
  } else if (path.sub === undefined) {
    for (const s of SUBS[path.root] ?? []) {
      children.push({
        label: s.label,
        to: { root: path.root, item: path.item, sub: { kind: s.kind as never, ...(s.arg ? { arg: s.arg } : {}) } },
        key: s.kind,
      });
    }
  }
  return (
    <div className="preview-scene">
      <h1>{title}</h1>
      <div className="preview-scene__go">
        {children.map((c) => (
          <button key={c.key} type="button" data-go={c.key} onClick={() => onGo(go(c.to))}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="preview-scene__field" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
    </div>
  );
}

export default function StagePreview() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const calm = q.get("calm") === "1";
  const [state, dispatch] = useReducer(reduce, INITIAL, (s): DepthState => {
    const at = q.get("at");
    return at ? { ...s, path: parseHash(at) } : s;
  });

  useEffect(() => applyMotion(calm ? "calm" : "full"), [calm]);

  const onGo = useCallback((to: Path) => dispatch({ type: "go", to }), []);
  const onRise = useCallback(() => dispatch({ type: "rise" }), []);
  const onSurface = useCallback(() => dispatch({ type: "surface" }), []);
  const onSettle = useCallback((seq: number) => dispatch({ type: "settle", seq }), []);

  return (
    <div style={{ height: "100vh" }}>
      <Stage
        state={state}
        calm={calm}
        renderScene={(path) => <Placeholder path={path} onGo={onGo} />}
        presence={{ pose: "resting", text: "resting", waiting: 0 }}
        onGo={onGo}
        onRise={onRise}
        onSurface={onSurface}
        onSettle={onSettle}
      />
    </div>
  );
}
