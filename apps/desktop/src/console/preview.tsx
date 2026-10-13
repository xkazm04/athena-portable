/**
 * The depth scenes in a plain browser — README section 3.5, ADR 0087 and 0090.
 *
 * `preview.html?scene=surface&fixture=asking` and `?scene=waking&fixture=engine-missing` draw the
 * surface's scenes, and `?scene=apps&fixture=heavy&at=%23/apps/host-1` draws a depth scene at a
 * place, inside the real stage with the water and the chrome around it and the actions inert.
 * Moving works: the stage's own depth reducer runs, so a scene's links dive. `&calm=1` renders
 * under Calm; `&theme=light` flips the theme; `&picker=1` adds a bar to change scene, fixture and
 * theme without editing the address.
 */
import { useEffect, useMemo, useReducer } from "react";

import {
  INITIAL,
  SURFACE,
  parseHash,
  reduce,
  shapeOf,
  type DepthState,
  type Path,
} from "@/depth/model";
import { applyMotion } from "@/lib/motion";
import type { ModuleEntry } from "@/modules/types";
import { entry as surface } from "@/scenes/surface";
import { entry as waking } from "@/scenes/waking";
import Stage from "@/stage/Stage";
import { THEMES, applyTheme, isTheme } from "@/stores/shell";

import { DEPTH_SCENES } from "@/scenes/registry";

const FIRST_ACT: Record<string, ModuleEntry> = { surface, waking };

const NAMES = [...Object.keys(FIRST_ACT), ...Object.keys(DEPTH_SCENES)];

export const isSceneName = (name: string | null): name is string => name !== null && NAMES.includes(name);

/** Rewrite the address bar, so a preview is always a link someone else can open. */
function relink(patch: Record<string, string>) {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) q.set(k, v);
  q.delete("at"); // a place belongs to the scene it was in
  window.location.search = q.toString();
}

export function ScenePreview({ name }: { name: string }) {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const calm = q.get("calm") === "1";
  const theme = q.get("theme");
  const depth = name in DEPTH_SCENES ? DEPTH_SCENES[name as keyof typeof DEPTH_SCENES] : null;
  const act = depth ? null : FIRST_ACT[name]!;
  const entry = depth ?? act!;
  const fixture = entry.fixtureIds.includes(q.get("fixture") ?? "") ? q.get("fixture")! : entry.fixtureIds[0]!;

  const [state, dispatch] = useReducer(reduce, INITIAL, (s): DepthState => {
    const at = q.get("at");
    return at ? { ...s, path: parseHash(at) } : depth ? { ...s, path: { root: depth.root } } : s;
  });

  useEffect(() => applyMotion(calm ? "calm" : "full"), [calm]);
  useEffect(() => applyTheme(isTheme(theme) ? theme : "dark"), [theme]);

  const go = (to: Path) => dispatch({ type: "go", to });
  const render = (path: Path) =>
    depth && path.root === depth.root ? depth.preview(fixture, { path, go }) : act ? act.preview(fixture) : null;
  const Band = depth && shapeOf(state.path) === "page" ? depth.Band : undefined;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {q.get("picker") === "1" && (
        <header className="harness__bar" data-testid="picker">
          <Picker label="scene" value={name} options={NAMES} onChange={(v) => relink({ scene: v })} />
          <Picker label="fixture" value={fixture} options={[...entry.fixtureIds]} onChange={(v) => relink({ fixture: v })} />
          <Picker
            label="theme"
            value={isTheme(theme) ? theme : "dark"}
            options={[...THEMES]}
            onChange={(v) => relink({ theme: v })}
          />
        </header>
      )}
      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        <Stage
          state={state}
          calm={calm}
          renderScene={render}
          label={depth?.previewLabeller?.(fixture)}
          band={Band ? <Band /> : undefined}
          presence={{ pose: "resting", text: "resting", waiting: 0 }}
          onGo={go}
          onRise={() => dispatch({ type: "rise" })}
          onSurface={() => dispatch({ type: "go", to: SURFACE })}
          onSettle={(seq) => dispatch({ type: "settle", seq })}
        />
      </div>
    </div>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="harness__field">
      <span className="typo-label muted">{label}</span>
      <select className="input typo-label focus-ring" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
