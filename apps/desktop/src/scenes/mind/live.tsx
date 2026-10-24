/**
 * The Mind depth, as the running app uses it — README section 3.5, ADR 0085, 0087, 0089 and 0090.
 *
 * It owns no store and builds no model of its own: the Setup module's hook supplies the view-model,
 * so every rule the module has (readiness, the engine's remedy, the failure to start, the restart
 * notice) is the one this scene shows. Passed in, because the console differs from the old bar:
 * "Show the welcome again" shows the first act on the surface without touching a stored row. The
 * view is a lazy chunk, fetched when the depth is first entered. The one store it reads itself is
 * the devices mirror (ADR 0140), and only while the Devices level is open.
 */
import { createElement, lazy, Suspense, useEffect, useMemo, useState } from "react";

import type { Labeller, Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { athenaSetup } from "@/lib/companion";
import { beginSetup } from "@/lib/setup";
import { useSetupModel } from "@/modules/setup/index";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useReopened } from "@/scenes/waking/reopen";
import { endpoint, useDaemon } from "@/stores/daemon";
import { ARM_MS, isArmed, sentenceOf, startDevices, useDevices } from "@/stores/devices";

import type { DevicesModel } from "./devices";

const MindView = lazy(() => import("./view"));

const NAMES: Record<string, string> = {
  engine: "Engine",
  brain: "Brain",
  look: "Look",
  data: "Data",
  mic: "Microphone",
  devices: "Devices",
};

export const labeller: Labeller = (path: Path) => (path.root === "mind" && path.item ? NAMES[path.item] : undefined);

/** How often `now` moves while a pairing request waits to arm. */
const TICK_MS = 250;

/**
 * The Devices level's model (ADR 0140): the store in, a `DevicesModel` out. The mirror is started
 * when the level opens and stopped when it closes, the way the connectors module loads on mount:
 * a surface nobody looks at follows no bus. While a pending request is not yet armed, `now` ticks
 * a few times a second so Approve wakes on time; otherwise it holds still.
 */
function useDevicesModel(open: boolean): DevicesModel | null {
  const state = useDevices();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    return startDevices();
  }, [open]);
  const waiting = (state.view?.pending ?? []).some((row) => !isArmed(state.seenAt[row.pairing_id], now));
  useEffect(() => {
    if (!open || !waiting) return;
    const timer = setInterval(() => setNow(Date.now()), Math.min(TICK_MS, ARM_MS));
    return () => clearInterval(timer);
  }, [open, waiting]);
  return useMemo(() => (open ? { state, now, setup: openSetupConversation, actions: state } : null), [open, state, now]);
}

/**
 * "Set up with Athena" (ADR 0140, WP4): open the daemon's setup session and hand it to her window,
 * where the person talks to her. The run store is hers alone (ADR 0026), so Main only opens the
 * door and passes the key, and her window opens the conversation itself. A refusal is shown under the
 * button, in the devices store's errors like every other act on this level; an empty sentence is
 * none, so the line goes on the next press and comes back only if that one fails too.
 */
const openSetupConversation = () => {
  const say = (setup: string) => useDevices.setState((s) => ({ errors: { ...s.errors, setup } }));
  say("");
  beginSetup({ endpoint: () => endpoint(useDaemon.getState()), hand: athenaSetup }).catch((error: unknown) => say(sentenceOf(error)));
};

/** Show the first act again: flag it, then go where it is drawn. The rows stay as they are. */
const reopen = () => {
  useReopened.getState().set(true);
  useDepth.getState().surface();
};

function Live({ path, go }: SceneProps) {
  const model = useSetupModel({ onReopen: reopen });
  // The devices mirror follows the event bus only while its level is open (ADR 0140).
  const devices = useDevicesModel(path.root === "mind" && path.item === "devices");
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(MindView, { model, path, go, devices }));
}

export const live: LiveScene = { root: "mind", Live, useLabeller: () => labeller };
