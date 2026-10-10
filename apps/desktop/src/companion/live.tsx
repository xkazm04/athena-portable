/**
 * The live companion — ADR 0026 ("Who runs which store", "Keyboard, voice, mouse", "First
 * launch"), README section 3.1. The one file of her window that knows a store exists.
 *
 * `Live` is where the halves meet: the run store's transcript and cards, the voice store's phase,
 * the page she is reading (tabs and tools), the origins table and the daemon go into
 * `selectCompanion`, one `CompanionModel` comes out, and the pure view renders it. Everything that
 * happens *to* her — Rust's `athena:orient`, `snap`, `summon` and `chord`, the keyboard, the
 * stores — becomes an `Event` for the machine; everything she asks for — a size, a show, an
 * answer — leaves through `RuntimeDeps`.
 *
 * Rust's `athena:ptt` is the exception (ADR 0027): the held chord goes to the voice store, not the
 * machine, and a turn it starts with her window hidden is *ambient* — the halo shows it, and her
 * form is left where it was until the turn ends.
 *
 * A store this file reads it does not start: `src/athena.tsx` starts the ones ADR 0026 assigns to
 * her window (tabs, tools, daemon, settings, origins, run, voice) and nothing else does.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createElement, useEffect, useState, useSyncExternalStore } from "react";

import { DaemonApi } from "@/lib/api";
import {
  athenaHide,
  athenaOpenMain,
  athenaPin,
  athenaReport,
  athenaSetSize,
  athenaShow,
  beginDrag,
  onChord,
  onOffer,
  onOrient,
  onPtt,
  onSnap,
  onSummon,
  pttHandler,
} from "@/lib/companion";
import { engineLabel, isEngineId } from "@/lib/engines";
import { setHaloOverride } from "@/lib/halo";
import { createRehearsal, type Rehearsal } from "@/lib/halo-rehearsal";
import { hasShell } from "@/lib/ipc";
import { openMicrophone } from "@/lib/voice";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useEngines } from "@/stores/engines";
import { useOrigins } from "@/stores/origins";
import { gatedListsOf, useRun } from "@/stores/run";
import { useSettings } from "@/stores/settings";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";
import { useVoice } from "@/stores/voice";

import {
  ledgerFrom,
  selectCompanion,
  type CompanionActions,
  type OriginView,
} from "./model";
import { createRuntime, lineOf, type Runtime, type RuntimeDeps } from "./runtime";
import { originOf, toolRows } from "./tools";
import CompanionView from "./views";

const report = (what: string) => (error: unknown) => console.error(`[athena] ${what}: ${String(error)}`);

/** The real collaborators. In a plain browser every command is skipped, not failed. */
function liveDeps(): RuntimeDeps {
  const shell = hasShell();
  return {
    size: (name, side, valign) => {
      if (shell) athenaSetSize(name, side, valign).catch(report("athena_set_size"));
    },
    show: (focus) => {
      if (shell) athenaShow(focus).catch(report("athena_show"));
    },
    hide: () => {
      if (shell) athenaHide().catch(report("athena_hide"));
    },
    pin: (on) => {
      if (shell) athenaPin(on).catch(report("athena_pin"));
    },
    cards: () => useRun.getState().cards,
    answer: (id, choice, settled) => void useRun.getState().answer(id, choice, settled).catch(report("answer")),
    // "Open your first app" sets `onboarded` and nothing else: Rust shows Main (ADR 0026).
    onboard: () => void useSettings.getState().setOnboarded(true).catch(report("onboard")),
    focus: (target) => {
      requestAnimationFrame(() => {
        const selector = target === "approve" ? '.aw [data-act="approve"]' : ".aw .aw-seal";
        document.querySelector<HTMLElement>(selector)?.focus();
      });
    },
    // The tray may have hidden her without telling the page, so a card asks the window.
    visible: () => (shell ? getCurrentWindow().isVisible() : Promise.resolve(true)),
    focusIn: () => document.querySelector(".aw")?.contains(document.activeElement) ?? false,
  };
}

function busy(): boolean {
  const phase = useRun.getState().phase;
  return phase === "running" || phase === "acting" || useVoice.getState().phase === "thinking";
}

/** A spoken turn in progress: an ambient turn ends when the voice leaves these. */
const TURN_PHASES = new Set(["listening", "thinking", "speaking"]);

/** The rehearsal, in a development build only (ADR 0027, decision 6). */
function liveRehearsal(): Rehearsal | null {
  if (!import.meta.env.DEV) return null;
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return createRehearsal({
    drive: setHaloOverride,
    // The real microphone, for its level only: `lib/voice.ts` publishes it to the halo itself.
    openMic: media?.getUserMedia
      ? () => openMicrophone({ getUserMedia: (c) => media.getUserMedia(c), audioContext: () => new AudioContext() }, () => {})
      : null,
    now: () => performance.now(),
    setTimeout: (f, ms) => window.setTimeout(f, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  });
}

/** Everything the window hears, as events for the machine. Returns what to undo. */
function connect(rt: Runtime): () => void {
  const off: Array<() => void> = [];
  let alive = true;

  // -- first launch: nothing is drawn until settings have answered ----------------------------
  let started = false;
  const start = () => {
    const settings = useSettings.getState();
    if (started || !settings.hydrated) return;
    started = true;
    rt.dispatch({ t: "init", onboarded: settings.onboarded, cards: 0 });
    rt.cardsChanged(useRun.getState().cards);
    rt.dispatch({ t: "work", on: busy() });
    rt.dispatch({ t: "listen", on: useVoice.getState().phase === "listening" });
  };
  off.push(
    useSettings.subscribe((s, prev) => {
      start();
      if (started && s.onboarded !== prev.onboarded) rt.dispatch({ t: "onboarded", value: s.onboarded });
    }),
  );
  start();

  // -- the run and the voice stores ------------------------------------------------------------
  // An ambient turn (a global push-to-talk with her window hidden) tells the machine nothing until
  // it ends; then `sync` and `hear` tell it the truth, which by then is usually "resting".
  let ambient = false;
  let working = busy();
  const sync = () => {
    if (!started || ambient) return;
    const now = busy();
    if (now !== working) {
      working = now;
      rt.dispatch({ t: "work", on: now });
    }
  };
  off.push(
    useRun.subscribe((s, prev) => {
      if (!started) return;
      if (s.cards !== prev.cards) rt.cardsChanged(s.cards);
      sync();
    }),
  );
  let listening = useVoice.getState().phase === "listening";
  const hear = () => {
    if (!started || ambient) return;
    const now = useVoice.getState().phase === "listening";
    if (now !== listening) {
      listening = now;
      rt.dispatch({ t: "listen", on: now });
    }
  };
  off.push(
    useVoice.subscribe((s, prev) => {
      if (ambient && s.phase !== prev.phase && !TURN_PHASES.has(s.phase)) ambient = false;
      // `hear` and `sync` below tell the machine what it missed, if anything.
      hear();
      sync();
    }),
  );

  // -- the global push-to-talk (ADR 0027) ------------------------------------------------------
  const setAmbient = (on: boolean) => {
    ambient = on;
    hear();
    sync();
  };
  const rehearsal = liveRehearsal();
  off.push(() => rehearsal?.dispose());
  const ptt = pttHandler({
    available: () => useVoice.getState().available,
    press: async () => {
      await useVoice.getState().press();
      // A press that never started a turn (refused, or failed into the error it was already in)
      // ends the ambient turn here, since no phase change will.
      if (!TURN_PHASES.has(useVoice.getState().phase)) setAmbient(false);
    },
    release: () => useVoice.getState().release(),
    visible: () => (hasShell() ? getCurrentWindow().isVisible() : Promise.resolve(true)),
    ambient: (on) => setAmbient(on),
    summon: () => rt.dispatch({ t: "summon" }),
    rehearsal,
  });

  // -- Rust's events -------------------------------------------------------------------------
  if (hasShell()) {
    void Promise.all([
      onOrient((o) => rt.dispatch({ t: "orient", side: o.side, valign: o.valign })),
      onSnap((s) => rt.dispatch({ t: "snap", docked: s.docked })),
      onSummon(() => rt.dispatch({ t: "summon" })),
      onChord((c) => rt.dispatch({ t: "decide", kind: c.kind, by: "chord" })),
      onPtt(ptt),
    ])
      .then((unlisten) => {
        if (alive) off.push(...unlisten);
        else unlisten.forEach((f) => f());
      })
      .catch(report("listen"));
  }

  // -- the keyboard, with her window focused --------------------------------------------------
  let lastPoke = 0;
  const poke = () => {
    const at = Date.now();
    if (at - lastPoke < 1000) return;
    lastPoke = at;
    rt.dispatch({ t: "poke" });
  };
  const onKey = (e: KeyboardEvent) => {
    poke();
    const target = e.target as HTMLElement | null;
    const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
    if (typing) {
      if (e.key === "Escape") {
        target?.blur();
        e.stopPropagation();
      }
      return;
    }
    const machine = rt.getSnapshot().machine;
    if (e.key === "Escape") {
      rt.dispatch({ t: "esc" });
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const answerable =
      machine.cards > 0 && (machine.form === "slip" || (machine.form === "ledger" && machine.tab === "talk"));
    const k = e.key.toLowerCase();
    if (answerable && (k === "a" || k === "d")) {
      rt.dispatch({ t: "decide", kind: k === "a" ? "approve" : "decline", by: "key" });
      e.preventDefault();
    } else if (machine.form === "welcome" && e.key === "Enter" && target?.tagName !== "BUTTON") {
      rt.dispatch({ t: "open" });
    }
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointerdown", poke);
  off.push(() => window.removeEventListener("keydown", onKey));
  off.push(() => window.removeEventListener("pointerdown", poke));

  return () => {
    alive = false;
    off.forEach((f) => f());
    rt.dispose();
  };
}

export default function Live() {
  const [rt] = useState(() => createRuntime(liveDeps()));
  useEffect(() => connect(rt), [rt]);
  const snap = useSyncExternalStore(rt.subscribe, rt.getSnapshot);

  const run = useRun();
  const daemon = useDaemon();
  const tabs = useTabs((s) => s.tabs);
  const byTab = useTools((s) => s.byTab);
  const voicePhase = useVoice((s) => s.phase);
  const voiceAvailable = useVoice((s) => s.available);
  const voicePartial = useVoice((s) => s.partial);
  const records = useOrigins((s) => s.records);
  const originsLoaded = useOrigins((s) => s.loaded);
  const originsProblem = useOrigins((s) => s.problem);
  const known = useOrigins((s) => s.known);
  const engine = useSettings((s) => s.engine);
  const onboarded = useSettings((s) => s.onboarded);
  const probes = useEngines((s) => s.probes);
  const probing = useEngines((s) => s.checking);
  const probeProblem = useEngines((s) => s.problem);

  const focused = tabs.find((tab) => tab.focused) ?? tabs[0];
  const origin = focused ? originOf(focused.url) : null;
  const tools = focused ? toolRows(byTab[focused.id], gatedListsOf({ records, known, loaded: originsLoaded, problem: originsProblem }, tabs, byTab)) : [];
  const ready = endpoint(daemon) !== null;

  // The record: what the daemon says it spent, read when her Record tab is open and again when a
  // turn ends. A failed read is shown on the tab, verbatim, not swallowed.
  const recording = snap.machine.form === "ledger" && snap.machine.tab === "record";
  const turnPhase = run.phase;
  useEffect(() => {
    if (!recording) return;
    const found = endpoint(useDaemon.getState());
    if (!found) return;
    let current = true;
    new DaemonApi(found)
      .ledger()
      .then((reply) => current && rt.setLedger(ledgerFrom(reply)))
      .catch(
        (e: unknown) =>
          current && rt.setLedger({ rows: [], footer: "", showing: 0, total: 0, problem: String(e) }),
      );
    return () => {
      current = false;
    };
  }, [rt, recording, ready, turnPhase]);

  // A command Main offered (ADR 0040): it becomes her composer's draft and opens her Talk tab.
  // Nothing is sent; the person presses send.
  const [offer, setOffer] = useState<{ n: number; text: string } | null>(null);
  useEffect(() => {
    if (!hasShell()) return;
    let off: (() => void) | null = null;
    let alive = true;
    onOffer(({ text, playbook }) => {
      setOffer((prev) => ({ n: (prev?.n ?? 0) + 1, text }));
      if (playbook) useRun.getState().setProject({ id: playbook.id, title: playbook.title, goal: text });
      rt.dispatch({ t: "open" });
      rt.dispatch({ t: "tab", tab: "talk" });
    })
      .then((unlisten) => {
        if (alive) off = unlisten;
        else unlisten();
      })
      .catch(report("listen offer"));
    return () => {
      alive = false;
      off?.();
    };
  }, [rt]);

  const actions: CompanionActions = {
    seal: () => rt.dispatch({ t: "seal" }),
    approve: (by) => rt.dispatch({ t: "decide", kind: "approve", by }),
    decline: (by) => rt.dispatch({ t: "decide", kind: "decline", by }),
    esc: () => rt.dispatch({ t: "esc" }),
    send: (message) => void run.send(message).catch(report("send")),
    clear: () => run.clear(),
    clearProject: () => run.setProject(null),
    pin: () => rt.dispatch({ t: "pin" }),
    tab: (tab) => rt.dispatch({ t: "tab", tab }),
    open: () => rt.dispatch({ t: "open" }),
    later: () => rt.dispatch({ t: "later" }),
    drag: (press) => {
      beginDrag(press);
    },
    micDown: () => void useVoice.getState().press(),
    micUp: () => useVoice.getState().release(),
    setOrigin: (o, enabled) => void useOrigins.getState().setEnabled(o, enabled).catch(report("origin")),
    openMain: () => {
      if (hasShell()) athenaOpenMain().catch(report("athena_open_main"));
    },
    checkEngines: () => void useEngines.getState().check(),
    useEngine: (id) => {
      if (isEngineId(id)) void useSettings.getState().setEngine(id).catch(report("engine"));
    },
  };

  const originViews: OriginView[] = known.map((o) => ({
    origin: o,
    enabled: records[o]?.enabled ?? false,
    overrides: Object.keys(records[o]?.overrides ?? {}).length,
  }));

  const model = selectCompanion({
    machine: snap.machine,
    run,
    voice: { phase: voicePhase, available: voiceAvailable, partial: voicePartial },
    daemonReady: ready,
    origin,
    tools,
    held: snap.held,
    known: originViews,
    ledger: snap.ledger,
    decisions: run.answered,
    engine: engineLabel(engine),
    engineId: engine,
    probes,
    probing,
    probeProblem,
    onboarded,
    offer,
    project: run.project,
    actions,
  });

  // What she is doing, for the tray dot, the chords and Main's status pill. Only a change is sent.
  const { form, cards } = model;
  // A turn that is running is work whatever form she is drawn in; the ledger with nothing running rests.
  const running = run.phase === "running" || run.phase === "acting";
  const line = lineOf(form, model.tape.cur, running);
  const ready0 = snap.machine.ready;
  useEffect(() => {
    if (!ready0 || !hasShell()) return;
    athenaReport(form, cards.length, line).catch(report("athena_report"));
  }, [ready0, form, cards.length, line]);

  if (!ready0) return createElement("div", { className: "aw", "data-state": "seal" });
  return createElement(CompanionView, { model });
}
