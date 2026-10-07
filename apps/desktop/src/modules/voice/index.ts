/**
 * ADR 0028 (Athena's voice is set up in a studio), README section 3.1 — the Voice `ModuleEntry`.
 *
 * The one file in this directory that subscribes to a store. Two meet here: `daemon` (is there a
 * daemon to talk to, and where) and the module's own `useVoiceSetup` (`live.ts`), which is pointed
 * at the daemon whenever its endpoint changes and never started from the app root — what the voice
 * setup holds matters only while this surface is open. The preview is the same view against a
 * fixture, with nothing behind it.
 */
import { createElement, useEffect } from "react";

import type { ModuleEntry } from "@/modules/types";
import { endpoint, useDaemon } from "@/stores/daemon";

import { fixtureIds, fixtures } from "./fixtures";
import { useVoiceSetup } from "./live";
import { selectVoice, type DaemonStanding } from "./model";
import VoiceView from "./view";

export function standingOf(health: string, loaded: boolean): DaemonStanding {
  if (health === "ready") return "ready";
  if (health === "failed" || (loaded && health === "stopped")) return "offline";
  return "starting";
}

function Live() {
  const daemon = useDaemon();
  const found = endpoint(daemon);
  const url = found?.url ?? null;
  const token = found?.token ?? null;
  const state = useVoiceSetup();

  useEffect(() => {
    void useVoiceSetup.getState().connect(url && token ? { url, token } : null);
  }, [url, token]);

  const model = selectVoice({
    daemon: standingOf(daemon.health, daemon.loaded),
    // Until the "studio done" row is read the mood is unknown, so the body waits rather than
    // flashing the studio at a person who finished it.
    config: state.studioDone === null ? null : state.config,
    problem: daemon.health === "ready" ? state.problem : daemon.lastError || state.problem,
    loading: state.studioDone === null || (state.config === null && state.problem === null),
    studioDone: state.studioDone ?? false,
    reopened: state.reopened,
    studio: state.studio,
    install: state.install,
    installError: state.installError,
    preview: state.preview,
    hear: state.hear,
    keyBusy: state.keyBusy,
    saveError: state.saveError,
    now: new Date(),
    actions: state.actions,
    meters: state.meters,
  });
  return createElement(VoiceView, { model });
}

export const entry: ModuleEntry = {
  id: "voice",
  label: "Voice",
  blurb: "Her voice and how she hears you: a studio the first time, settings after it.",
  fixtureIds,
  preview: (fixture) => createElement(VoiceView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};
