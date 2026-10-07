/**
 * Athena's window root — ADR 0026 ("Who runs which store"), README section 3.1.
 *
 * The app root is now two roots. This one starts exactly the stores the ADR assigns to `athena`:
 * tabs, tools, daemon, settings and origins (mirrors of Rust events or of the daemon, which two
 * windows can hold without disagreeing) and voice (the microphone has one owner). The run store
 * has no `start`: it is the turn, and it lives in this window alone. The shell and connectors
 * stores are Main's and are not started here. The halo's producer (ADR 0027) starts here too: it
 * reads the voice and the run, so it lives where they do.
 *
 * A store a *view* starts stops being true (the day-zero rule of 0013), so `Live` only reads.
 */
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";

import Live from "@/companion/live";
import { startHalo } from "@/lib/halo";
import { startDaemon } from "@/stores/daemon";
import { startEngines } from "@/stores/engines";
import { startOrigins } from "@/stores/origins";
import { startRun } from "@/stores/run";
import { startSettings } from "@/stores/settings";
import { startTabs } from "@/stores/tabs";
import { startTools } from "@/stores/tools";
import { startVoice } from "@/stores/voice";

import "@/styles/app.css";
import "@/companion/companion.css";

function Root() {
  useEffect(() => {
    void startTabs();
    void startTools();
    void startDaemon();
    void startSettings();
    void startOrigins();
    // The cards are the daemon's too: ask what it holds at start, when it is ready, and every 30 s
    // while a card is on screen (UAT backlog B1). The engine probe feeds the welcome's engine line.
    const stopRun = startRun();
    startEngines();
    // Push-to-talk is a held key in her window (ADR 0020, 0026): Ctrl+Space while she is focused.
    void startVoice();
    // The halo has one producer and it is this window, because the voice and the run are (ADR 0027).
    const stopHalo = startHalo();
    return () => {
      stopHalo();
      stopRun();
    };
  }, []);
  return <Live />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
