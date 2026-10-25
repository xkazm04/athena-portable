/**
 * The console — README section 3.1 and 3.5, ADR 0026, 0087 and 0090.
 *
 * The stage, wired to the stores: where the window is (`depth/store`), how she is (`athena`), and
 * what the settings say (first act or surface, Calm). It starts nothing; `root.tsx` does. It is
 * the one place that turns the stage's callbacks into depth moves and her mirror into a presence,
 * and that gathers the crumb names the scenes know and the band the Apps scene owns.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { poseOf, POSE_WORDS } from "@/bell/pose";
import { useVoicePhase } from "@/bell/voice-phase";
import WindowControls from "@/components/WindowControls";
import { samePath, shapeOf, type Labeller, type Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { resolveMotion, systemPrefersReduced } from "@/lib/motion";
import Stage from "@/stage/Stage";
import { pillText, useAthena } from "@/stores/athena";
import { useReopened } from "@/scenes/waking/reopen";
import { readRows, useSettings } from "@/stores/settings";

import { useFollowShell } from "./follow";
import { LIVE_SCENES, sceneFor } from "./scenes";

const SCENES = Object.values(LIVE_SCENES);
const DueNotice = lazy(() => import("./due-notice"));
const Finder = lazy(() => import("./finder"));

const retryRead = () => void readRows();

/**
 * Every scene's crumb names, in one labeller. The hooks are called for every scene on every render
 * and in one fixed order, which is what keeps them legal however the depth changes.
 */
function useLabeller(): Labeller {
  const labellers = SCENES.map((s) => s.useLabeller?.());
  return (path: Path) => {
    for (const l of labellers) {
      const name = l?.(path);
      if (name !== undefined) return name;
    }
    return undefined;
  };
}

/** Should this key summon the finder? Ctrl+K (Cmd+K) anywhere, "/" only outside a field. */
export function opensFinder(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">, typing: boolean): boolean {
  return e.altKey ? false : e.ctrlKey || e.metaKey ? e.key.toLowerCase() === "k" : e.key === "/" && !typing;
}

/** The places visited, most recent first: the finder's "switch back" list. */
let recent: Path[] = [];

/**
 * Go anywhere by name: the key and the bar's control that summon the finder. The finder itself is
 * a lazy chunk, fetched on the first summon, so the first frame carries only this.
 */
export function Summon({ go, label, here }: { go: (to: Path) => void; label?: Labeller; here: Path }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    recent = [here, ...recent.filter((p) => !samePath(p, here))].slice(0, 8);
  }, [here]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!e.defaultPrevented && opensFinder(e, t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button type="button" className="window-btn focus-ring" title="Go to a place (Ctrl+K)" onClick={() => setOpen(true)}>
        <svg className="window-btn__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.8-4.8" />
        </svg>
      </button>
      {open && (
        <Suspense fallback={null}>
          <Finder go={go} label={label} here={here} recent={recent} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

export default function Console() {
  const path = useDepth((s) => s.path);
  const from = useDepth((s) => s.from);
  const move = useDepth((s) => s.move);
  const seq = useDepth((s) => s.seq);
  const go = useDepth((s) => s.go);
  const rise = useDepth((s) => s.rise);
  const surface = useDepth((s) => s.surface);
  const settle = useDepth((s) => s.settle);

  const athena = useAthena();
  const voice = useVoicePhase();
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.onboarded);
  const problem = useSettings((s) => s.problem);
  const motion = useSettings((s) => s.motion);
  const reopened = useReopened((s) => s.on);
  const label = useLabeller();
  useFollowShell();

  const pose = poseOf({ ...athena, voice });
  // A chore that came due (ADR 0131): its notice rides the dock, a lazy chunk off the first frame.
  const notice = (
    <Suspense fallback={null}>
      <DueNotice go={go} />
    </Suspense>
  );
  const render = useCallback(
    (p: Path) => sceneFor(p, { hydrated, onboarded, reopened, go, problem, retry: retryRead }),
    [hydrated, onboarded, reopened, go, problem],
  );
  const Band = shapeOf(path) === "page" && path.root !== null ? LIVE_SCENES[path.root].Band : undefined;

  return (
    <Stage
      state={{ path, from, move, seq }}
      calm={resolveMotion(motion, systemPrefersReduced()) === "calm"}
      renderScene={render}
      label={label}
      band={Band ? <Band /> : undefined}
      presence={{
        pose,
        text: pose === "resting" || pose === "speaking" ? POSE_WORDS[pose] : pillText(athena),
        waiting: athena.cards,
        notice,
      }}
      onGo={go}
      onRise={rise}
      onSurface={surface}
      onSettle={settle}
      trailing={
        <>
          {/* A page owns the window below the band (ADR 0088), so the finder is summoned over a scene. */}
          {shapeOf(path) === "scene" && <Summon go={go} label={label} here={path} />}
          <WindowControls waiting={athena.cards > 0} />
        </>
      }
    />
  );
}
