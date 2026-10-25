/**
 * The surface, as the running app uses it — the one file here that knows a store exists.
 *
 * It reads and starts nothing: the app root starts the stores (README 3.5). Ten are read here:
 * her status (the mirror, with her face's phase beside it), the origins, the tabs, the connectors,
 * the voice's availability, the engine's probe, the daemon (which engine it runs, and whether it
 * started), the shipped playbooks, the settings and the projects (ADR 0225), the last as the spaces
 * store's first-frame mirror (`stores/spaces-glance.ts`), so the store itself stays off the first
 * frame. `useSurfaceModel` is a hook so the console can compose the same model into other views.
 */
import { createElement, useEffect, useMemo } from "react";

import { useVoicePhase } from "@/bell/voice-phase";
import { useDepth } from "@/depth/store";
import { athenaOffer, athenaShow, athenaToggle } from "@/lib/companion";
import { ENGINE_IDS, engineLabel } from "@/lib/engines";
import type { Playbook } from "@/lib/playbooks";
import { hostOf } from "@/lib/url";
import { standingOf } from "@/modules/connectors/model";
import { selectPlaybooks } from "@/modules/playbooks/model";
import { INERT_ACTIONS as INERT_SETUP_ACTIONS, selectSetup } from "@/modules/setup/model";
import { engineFact } from "@/modules/setup/readiness";
import { hasShell } from "@/lib/ipc";
import { useAthena } from "@/stores/athena";
import { useConnectors } from "@/stores/connectors";
import { useDaemon } from "@/stores/daemon";
import { useEngines } from "@/stores/engines";
import { useOrigins } from "@/stores/origins";
import { usePlaybooks } from "@/stores/playbooks";
import { useSettings } from "@/stores/settings";
import { activeName, useSpacesGlance } from "@/stores/spaces-glance";
import { useTabs } from "@/stores/tabs";
import { useVoice } from "@/stores/voice";

import { selectSurface, type SurfaceActions, type SurfaceModel } from "./model";
import SurfaceView from "./view";

const NO_ACTIONS = { copy: () => Promise.resolve(), open: () => {}, hand: () => {} };

const ACTIONS: SurfaceActions = {
  // The mirror's hand-over (decision D1): the sentence goes to her own window, which answers.
  ask: (text) => athenaOffer(text),
  // A window that will not come forward is told on the surface (the view) and kept in the log.
  summon: () =>
    athenaShow().catch((e: unknown) => {
      console.error(`[surface] summon: ${String(e)}`);
      throw e;
    }),
  // Her illustration is the switch (fleet-surfaces D2). Rust answers with where she ended up and
  // says it on `athena:status` too, which is what moves the label; a plain browser has no window
  // of hers, so the press is skipped there, not failed.
  toggle: () => {
    if (!hasShell()) return;
    athenaToggle().catch((e: unknown) => console.error(`[surface] toggle: ${String(e)}`));
  },
  dive: (to) => useDepth.getState().go(to),
};

export /** The chores line of the surface: counted from the shipped set once it has arrived. */
function totalsOf(items: readonly Playbook[] | null) {
  const t = selectPlaybooks(items ?? [], NO_ACTIONS).totals;
  return { total: t.count, benched: t.benched, foundUsd: t.foundUsd };
}

export function useSurfaceModel(): SurfaceModel {
  const athena = useAthena();
  const voice = useVoicePhase();
  const records = useOrigins((s) => s.records);
  const known = useOrigins((s) => s.known);
  const tabs = useTabs((s) => s.tabs);
  const connectors = useConnectors((s) => s.items);
  const notice = useConnectors((s) => s.recordsNotice);
  const voiceAvailable = useVoice((s) => s.available);
  const engine = useSettings((s) => s.engine);
  const avatar = useSettings((s) => s.avatar);
  const probes = useEngines((s) => s.probes);
  const checking = useEngines((s) => s.checking);
  const problem = useEngines((s) => s.problem);
  const daemonHealth = useDaemon((s) => s.health);
  const daemonEngine = useDaemon((s) => s.engine);
  const daemonLoaded = useDaemon((s) => s.loaded);
  const daemonError = useDaemon((s) => s.lastError);
  const playbooks = usePlaybooks((s) => s.items);
  const playbooksProblem = usePlaybooks((s) => s.problem);
  const projectsCount = useSpacesGlance((s) => s.names.length);
  const projectsLoaded = useSpacesGlance((s) => s.loaded);
  const projectsFailed = useSpacesGlance((s) => s.failed);
  const projectsActive = useSpacesGlance(activeName);
  // Counting the chores needs the shipped set; fetched once, after the first frame has been drawn.
  useEffect(() => {
    const ask = () => void usePlaybooks.getState().load();
    const id = typeof requestIdleCallback === "function" ? requestIdleCallback(ask) : window.setTimeout(ask, 300);
    return () => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(id) : window.clearTimeout(id));
  }, []);

  return useMemo(() => {
    // The Mind light reads the Setup module's own rule, not the probe alone: found is the probe's
    // word, ready is the daemon's too (README 3.5, `modules/setup/readiness.ts`).
    const setup = selectSetup({
      onboarded: true,
      hydrated: true,
      engine,
      engineIds: ENGINE_IDS,
      probes,
      problem,
      checking,
      theme: "system",
      brainPath: "",
      tabs: [],
      storePath: null,
      daemonHealth,
      daemonEngine,
      daemonError,
      daemonLoaded,
      actions: INERT_SETUP_ACTIONS,
    });
    const fact = engineFact(setup);
    return selectSurface({
      athena: { state: athena.state, cards: athena.cards, line: athena.line, voice },
      windowVisible: athena.visible,
      apps: known.flatMap((origin) => {
        const row = records[origin];
        return row ? [{ id: origin, host: hostOf(origin), enabled: row.enabled }] : [];
      }),
      openTabs: tabs.length,
      projects: { count: projectsCount, loaded: projectsLoaded, failed: projectsFailed, active: projectsActive },
      accounts: connectors.map((c) => {
        // The connectors module's standing, word and sentence: the need says it as the level does.
        const { standing: s, word, sentence } = standingOf(c, undefined, notice);
        return {
          id: c.id,
          label: c.label,
          connected: s === "connected",
          attention: s === "needs-reauth" || s === "broken" || s === "unconfirmed",
          word,
          line: sentence,
        };
      }),
      chores: { ...totalsOf(playbooks), loaded: playbooks !== null, failed: playbooks === null && playbooksProblem !== null },
      voiceAvailable,
      voiceKnown: daemonHealth === "ready",
      engine: {
        label: engineLabel(engine),
        standing: fact.standing,
        checkFailed: !setup.checking && setup.problem !== null,
        summary: fact.summary,
      },
      pendingRestart: setup.pendingEngine
        ? { label: engineLabel(setup.pendingEngine), running: engineLabel(setup.daemonEngine) }
        : null,
      inShell: hasShell(),
      avatar,
      actions: ACTIONS,
    });
  }, [
    athena,
    voice,
    avatar,
    records,
    known,
    tabs,
    connectors,
    notice,
    voiceAvailable,
    engine,
    probes,
    checking,
    problem,
    daemonHealth,
    daemonEngine,
    daemonLoaded,
    daemonError,
    playbooks,
    playbooksProblem,
    projectsCount,
    projectsLoaded,
    projectsFailed,
    projectsActive,
  ]);
}

export function Live() {
  return createElement(SurfaceView, { model: useSurfaceModel() });
}
