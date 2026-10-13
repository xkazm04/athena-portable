/**
 * The surface's `ModuleEntry` — the one file here that knows a store exists.
 *
 * It reads and starts nothing: the app root starts the stores (README 3.5). Seven are read here:
 * her status (the mirror), the origins, the tabs, the connectors, the voice's availability, the
 * engine's probe and the settings. `useSurfaceModel` is a hook so the console can compose the same
 * model into other views.
 */
import { createElement, useMemo } from "react";

import { useDepth } from "@/depth/store";
import { athenaOffer, athenaShow } from "@/lib/companion";
import { engineLabel, probeOf } from "@/lib/engines";
import { hostOf } from "@/lib/url";
import { standingOf } from "@/modules/connectors/model";
import { selectPlaybooks } from "@/modules/playbooks/model";
import { PLAYBOOKS } from "@/lib/playbooks";
import { hasShell } from "@/lib/ipc";
import type { ModuleEntry } from "@/modules/types";
import { useAthena } from "@/stores/athena";
import { useConnectors } from "@/stores/connectors";
import { useEngines } from "@/stores/engines";
import { useOrigins } from "@/stores/origins";
import { useSettings } from "@/stores/settings";
import { useTabs } from "@/stores/tabs";
import { useVoice } from "@/stores/voice";

import { fixtureIds, fixtures } from "./fixtures";
import { selectSurface, type SurfaceActions, type SurfaceModel } from "./model";
import SurfaceView from "./view";

const CHORES = selectPlaybooks(PLAYBOOKS, { copy: () => {}, open: () => {}, hand: () => {} }).totals;

const ACTIONS: SurfaceActions = {
  // The mirror's hand-over (decision D1): the sentence goes to her own window, which answers.
  ask: (text) => athenaOffer(text),
  summon: () => void athenaShow().catch((e: unknown) => console.error(`[surface] summon: ${String(e)}`)),
  dive: (root) => useDepth.getState().go({ root }),
};

export function useSurfaceModel(): SurfaceModel {
  const athena = useAthena();
  const records = useOrigins((s) => s.records);
  const known = useOrigins((s) => s.known);
  const tabs = useTabs((s) => s.tabs);
  const connectors = useConnectors((s) => s.items);
  const notice = useConnectors((s) => s.recordsNotice);
  const voiceAvailable = useVoice((s) => s.available);
  const engine = useSettings((s) => s.engine);
  const probes = useEngines((s) => s.probes);

  return useMemo(() => {
    const chosen = probes === null ? null : probeOf(probes, engine);
    return selectSurface({
      athena: { state: athena.state, cards: athena.cards, line: athena.line },
      apps: known.flatMap((origin) => {
        const row = records[origin];
        return row ? [{ id: origin, host: hostOf(origin), enabled: row.enabled }] : [];
      }),
      openTabs: tabs.length,
      accounts: connectors.map((c) => {
        const s = standingOf(c, undefined, notice).standing;
        return {
          id: c.id,
          label: c.label,
          connected: s === "connected",
          attention: s === "needs-reauth" || s === "broken" || s === "unconfirmed",
        };
      }),
      chores: { total: CHORES.count, benched: CHORES.benched, foundUsd: CHORES.foundUsd },
      voiceAvailable,
      engine: { label: engineLabel(engine), ready: chosen === null ? null : chosen.state === "found" },
      inShell: hasShell(),
      actions: ACTIONS,
    });
  }, [athena, records, known, tabs, connectors, notice, voiceAvailable, engine, probes]);
}

function Live() {
  return createElement(SurfaceView, { model: useSurfaceModel() });
}

export const entry: ModuleEntry = {
  id: "surface",
  label: "Athena",
  blurb: "The surface: her bell, what she is doing, and the five lights beneath her.",
  fixtureIds,
  preview: (fixture) => createElement(SurfaceView, { model: fixtures[fixture] ?? fixtures.typical! }),
  Live,
};
