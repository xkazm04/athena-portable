/**
 * Her face in a plain browser - ADR 0120, ADR 0087 (the preview harness).
 *
 * `preview.html?scene=avatar` draws a form driven by a scripted signal:
 *
 * ```
 * ?scene=avatar&avatar=b04-owl|d08-origami|both   which form (default the owl)
 *   &fixture=none|calm|level|blink                 what drives it (fixtures.ts; default none)
 *   &phase=idle|listening|thinking|speaking|gate   the phase a held fixture shows (default idle)
 *   &at=1.1                                        hold the line at 1.1 s (a still to look at)
 *   &autoplay=1  &loop=1                           play the line on load / over and over
 *   &size=520  &calm=1                             box size; render under Calm
 * ```
 *
 * The Play button (`data-avatar-play`) plays the line once; the perf gate's `avatar` drive presses
 * it. The fixture is stepped on the window's one frame clock, so the page still runs one loop.
 */
import { useEffect, useMemo, useState } from "react";

import { applyMotion, frames } from "@/lib/motion";

import { Avatar } from "./Avatar";
import { fixtureDuration, fixtureSignal, isFixture, type Fixture } from "./fixtures";
import { AVATAR_IDS, RESTING, type FaceAvatarId, type FacePhase, type FaceSignal, type FaceSource } from "./types";

const PHASES: FacePhase[] = ["idle", "listening", "thinking", "speaking", "gate"];

/** A source the page pushes signals into. */
function pushSource(): FaceSource & { push(s: FaceSignal): void } {
  const listeners = new Set<(s: FaceSignal) => void>();
  let last: FaceSignal = RESTING;
  return {
    subscribe(fn) {
      listeners.add(fn);
      fn(last);
      return () => listeners.delete(fn);
    },
    push(s) {
      last = s;
      for (const fn of listeners) fn(s);
    },
  };
}

export default function AvatarPreview() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const which = q.get("avatar") ?? "b04-owl";
  const forms: FaceAvatarId[] =
    which === "both" ? ["b04-owl", "d08-origami"] : [(AVATAR_IDS as readonly string[]).includes(which) && which !== "halo" ? (which as FaceAvatarId) : "b04-owl"];
  const fixtureParam = q.get("fixture");
  const fixture: Fixture = isFixture(fixtureParam) ? fixtureParam : "none";
  const phaseParam = q.get("phase") as FacePhase | null;
  const phase: FacePhase = phaseParam && PHASES.includes(phaseParam) ? phaseParam : "idle";
  const at = q.get("at");
  const size = Number(q.get("size")) || 520;
  const calm = q.get("calm") === "1";
  const source = useMemo(() => pushSource(), []);
  const [playing, setPlaying] = useState(() => q.get("autoplay") === "1" && fixtureDuration(fixture) > 0);

  useEffect(() => applyMotion(calm ? "calm" : "full"), [calm]);

  // a held state: one signal (a fixture held at `at`, or the phase at rest)
  useEffect(() => {
    source.push(fixtureSignal(fixture, at === null ? (fixtureDuration(fixture) ? Infinity : 0) : Number(at), phase));
  }, [source, fixture, phase, at]);

  // a playing line, stepped on the one clock
  useEffect(() => {
    if (!playing) return;
    const length = fixtureDuration(fixture);
    let t = 0;
    const stop = frames().subscribe((_time, delta) => {
      t += delta / 1000;
      if (t >= length) {
        source.push(fixtureSignal(fixture, length, "idle"));
        if (q.get("loop") === "1") {
          t = 0;
          return true;
        }
        setPlaying(false);
        return false;
      }
      source.push(fixtureSignal(fixture, t, phase));
      return true;
    });
    return stop;
  }, [playing, fixture, phase, source, q]);

  return (
    <div style={{ background: "#000", minHeight: "100vh", padding: 24, color: "#cfe9ee", font: "13px system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button type="button" data-avatar-play disabled={playing || fixtureDuration(fixture) === 0} onClick={() => setPlaying(true)}>
          Play
        </button>
        <span data-avatar-status>{playing ? "playing" : `${fixture}, ${phase}`}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
        {forms.map((f) => (
          <Avatar key={f} avatar={f} size={size} source={source} />
        ))}
      </div>
    </div>
  );
}
