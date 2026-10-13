/**
 * The console's app root — README section 3.1 and 3.5, ADR 0026 and 0087.
 *
 * The same job `app.tsx` has and for the same reason (the day-zero rule of 3.5): the stores that
 * must stay true while the person is looking at something else are started here and by nothing
 * else. The set is exactly the module bar's, plus the two the stage adds: where the window is
 * (`depth`) and the seam that tells Rust which shape it is in (`depth/shape`).
 */
import { useEffect } from "react";

import { startDepth } from "@/depth/store";
import { startShapeSync } from "@/depth/shape";
import { startConnectors } from "@/stores/connectors";
import { startAthena } from "@/stores/athena";
import { startDaemon } from "@/stores/daemon";
import { startEngines } from "@/stores/engines";
import { startOrigins } from "@/stores/origins";
import { startSettings } from "@/stores/settings";
import { startShell } from "@/stores/shell";
import { startTabs } from "@/stores/tabs";
import { startTools } from "@/stores/tools";

import Console from "./Console";
import "./console.css";

export default function ConsoleRoot() {
  useEffect(() => {
    void startShell();
    void startTabs();
    void startTools();
    void startDaemon();
    void startSettings();
    void startOrigins();
    void startConnectors();
    void startEngines();
    void startAthena();
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
