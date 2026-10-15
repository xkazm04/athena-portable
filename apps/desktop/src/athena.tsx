/**
 * Athena's window root — ADR 0026 ("Who runs which store"), README section 3.1.
 *
 * The app root is now two roots. This one starts exactly the stores the ADR assigns to `athena`:
 * tabs, tools, daemon, settings and origins (mirrors of Rust events or of the daemon, which two
 * windows can hold without disagreeing) and voice (the microphone has one owner). The run store
 * has no `start`: it is the turn, and it lives in this window alone. The shell store is Main's and
 * is not started here. The connectors store is Main's to act on; here it is a read-only mirror
 * (ADR 0116, amending 0026), read once for each connector card that arrives and again when Main
 * says a connector moved, so the card can name the account it acts as. The halo's producer
 * (ADR 0027) starts here too: it reads the voice and the run, so it lives where they do.
 *
 * A store a *view* starts stops being true (the day-zero rule of 0013), so `Live` only reads.
 */
import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";

import Live from "@/companion/live";
import { startHalo } from "@/lib/halo";
import { followCards, startConnectors } from "@/stores/connectors";
import { startDaemon } from "@/stores/daemon";
import { startEngines } from "@/stores/engines";
import { startOrigins } from "@/stores/origins";
import { startRun, useRun } from "@/stores/run";
import { startSettings } from "@/stores/settings";
import { startTabs } from "@/stores/tabs";
import { startTools } from "@/stores/tools";
import { startVoice } from "@/stores/voice";

import "@/styles/app.css";
import "@/companion/companion.css";

// The dev inspector (ADR 0086): dropped from a build with the rest of the DEV branch.
const Inspector = import.meta.env.DEV ? lazy(() => import("@/lib/dev/inspector")) : null;

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
    // A connector card names the account it acts as: the mirror reads when one arrives (ADR 0116).
    void startConnectors();
    const stopMirror = followCards(
      () => useRun.getState().cards,
      (f) =>
        useRun.subscribe((s, prev) => {
          if (s.cards !== prev.cards) f();
        }),
    );
    // Push-to-talk is a held key in her window (ADR 0020, 0026): Ctrl+Space while she is focused.
    void startVoice();
    // The halo has one producer and it is this window, because the voice and the run are (ADR 0027).
    const stopHalo = startHalo();
    return () => {
      stopMirror();
      stopHalo();
      stopRun();
    };
  }, []);
  return (
    <>
      <Live />
      {Inspector && (
        <Suspense fallback={null}>
          <Inspector />
        </Suspense>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
