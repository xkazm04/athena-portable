/**
 * The console's app root — README section 3.1 and 3.5, ADR 0026 and 0087.
 *
 * The job the old app root had until the cutover (ADR 0095), for the same reason (the day-zero rule
 * of 3.5): the stores that must stay true while the person is looking at something else are started
 * here and by nothing else. The set is the one ADR 0026 gives Main, plus the two the stage adds:
 * where the window is (`depth`) and the seam that tells Rust which shape it is in (`depth/shape`).
 */
import { useEffect } from "react";

import { startDepth } from "@/depth/store";
import { startShapeSync } from "@/depth/shape";
import { startConnectors } from "@/stores/connectors";
import { isResting, startAthena, useAthena } from "@/stores/athena";
import { startDaemon } from "@/stores/daemon";
import { startEngines } from "@/stores/engines";
import { startOrigins } from "@/stores/origins";
import { startSettings } from "@/stores/settings";
import { startShell } from "@/stores/shell";
import { startSpaces, type TurnSignal } from "@/stores/spaces";
import { startTabs } from "@/stores/tabs";
import { startTools } from "@/stores/tools";

import Console from "./Console";
import "./console.css";

/**
 * Whether she is working, as Main can know it (ADR 0225): the turn lives in her window, and Main
 * sees only what Rust mirrors of her (`athena:status`). A Project switch asked for here while she
 * works is held until she rests; her window, which holds the turn itself, holds it too if a turn
 * is still running when the row arrives, so no turn is ever filed under two Projects.
 */
const herTurn: TurnSignal = {
  busy: () => !isResting(useAthena.getState().state, useAthena.getState().line),
  onIdle: (f) =>
    useAthena.subscribe((s, prev) => {
      if (isResting(s.state, s.line) && !isResting(prev.state, prev.line)) f();
    }),
};

export default function ConsoleRoot() {
  useEffect(() => {
    startShell();
    void startTabs();
    void startTools();
    void startDaemon();
    void startSettings();
    void startOrigins();
    void startConnectors();
    void startEngines();
    void startAthena();
    // The Projects and the one she works in: the bar's pill and every scene read it (ADR 0225).
    void startSpaces(herTurn);
    const stopDepth = startDepth();
    const stopShape = startShapeSync();
    return () => {
      stopShape();
      stopDepth();
    };
  }, []);
  return (
    <div className="console">
      <Console />
    </div>
  );
}
