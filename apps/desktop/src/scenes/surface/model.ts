/**
 * The surface's view-model — README section 3.1 and 3.5, ADR 0026, 0087 and 0225.
 *
 * The surface is Athena and the five lights beneath her: Projects first, where Apps stood until
 * ADR 0225 (`SURFACE_ROOTS`); the apps she reaches are still her tendrils. It is a **mirror**
 * (decision D1, ADR 0087): Main holds no run and no microphone, so what it shows of her is what
 * `athena:status` reports and the phase her face mirrors on `athena:face` (ADR 0222), and talking to
 * her is handing text to her own window. Nothing here pretends otherwise: the ask box says it hands
 * the words over, and the cards waiting are answered in her window.
 *
 * What needs the person is named on the surface, each one press from its item (`needs`): an
 * account to reconnect, an engine that cannot run, a restart that is pending. Every need is a dive,
 * never an answer, so the mirror stays a mirror; the cards waiting are not needs, they are answered
 * in her window (the summon).
 *
 * Pure, as every module model is: `selectSurface` takes plain facts and returns what to draw, and
 * the selector's caller (`index.tsx`) is the only file that knows a store exists.
 */
import type { GlyphFacts } from "@/art/glyphs";
import type { AvatarId } from "@/avatar/types";
import type { Reach } from "@/bell/Bell";
import { POSE_WORDS, poseOf, type Pose, type PoseInput } from "@/bell/pose";
import { ROOT_LABEL, SURFACE_ROOTS, type Path, type SurfaceRoot } from "@/depth/model";
import type { Standing } from "@/modules/setup/readiness";
import { pillText } from "@/stores/athena";

export interface SurfaceActions {
  /** Hand a sentence to her window. Rejects with a sentence when it cannot (no shell). */
  ask: (text: string) => Promise<void>;
  /** Bring her own window forward: the cards waiting are answered there. Rejects when it cannot. */
  summon: () => Promise<void>;
  /**
   * Show her window if it is put away, put it away if it is shown (fleet-surfaces D2). Her
   * illustration is the switch. Rust's own `visible` decides which, not `windowVisible` below.
   * `at` is the illustration's centre in the page's px: a show brings her there, so the person
   * does not have to look for her window.
   */
  toggle: (at?: { x: number; y: number }) => void;
  /** Go to a place below the surface: a depth's field, or straight to the item that needs you. */
  dive: (to: Path) => void;
}

export interface SurfaceSources {
  /** Her status mirror, and her face's phase when `athena:face` has said one. */
  athena: PoseInput;
  /** Her window is on the screen, as `athena:status` last said (`useAthena().visible`). */
  windowVisible: boolean;
  /** Apps she has been told about, switched on or off. */
  apps: readonly { id: string; host: string; enabled: boolean }[];
  openTabs: number;
  /**
   * The person's projects (ADR 0225): how many, whether the list has answered or failed, and the
   * name of the one she works in, "" for her core.
   */
  projects: { count: number; loaded: boolean; failed: boolean; active: string };
  /**
   * `word` and `line` are the connectors module's own standing for the account (`standingOf`):
   * the surface names why an account needs the person in the words its level uses.
   */
  accounts: readonly { id: string; label: string; connected: boolean; attention: boolean; word: string; line: string }[];
  /**
   * `loaded` is false while the shipped playbooks are still being fetched (they load lazily);
   * `failed` is true when that fetch failed, which is not the same fact as one still on its way.
   * `foundUsd` is money back only (ADR 0133): an exposure protected or a scoring weight is never in it.
   */
  chores: { total: number; benched: number; foundUsd: number; loaded: boolean; failed: boolean };
  voiceAvailable: boolean;
  /**
   * The daemon is up, so `voiceAvailable` is an answer. Before that (starting, failed, stopped) an
   * unavailable voice is not known, as the Mind depth's Voice card says, not "not set up".
   */
  voiceKnown: boolean;
  /**
   * The chosen engine as the Setup module's `engineFact` stands it, so the light and the Mind
   * depth one dive below cannot disagree. `checkFailed`: the probe could not run at all, which is
   * not the same fact as a check still in flight.
   */
  engine: {
    label: string;
    standing: Standing;
    checkFailed: boolean;
    /** The engine fact's own summary (`engineFact`): the need's reason, as the Mind depth says it. */
    summary: string;
  };
  /**
   * An engine chosen that the daemon is not yet running on (`pendingEngine`): the chosen engine's
   * label and the one she runs on, or null when there is none.
   */
  pendingRestart: { label: string; running: string } | null;
  /** False in a plain browser, where there is no window of hers to hand anything to. */
  inShell: boolean;
  /** How she appears (the `avatar` setting); the halo when not given. */
  avatar?: AvatarId;
  actions: SurfaceActions;
}

export interface Light {
  root: SurfaceRoot;
  /** Where its press goes: its first need when it is under attention, else its depth's field. */
  to: Path;
  label: string;
  /** One short line of what is live in it: a count, a standing. */
  stat: string;
  /** What diving in is for, shown when the light is under attention. */
  hint: string;
  /** True when it needs the person: an account that wants reconnecting, an engine that is not ready. */
  attention: boolean;
  /** What its glyph draws of it: the same numbers as `stat`, with `of: null` for a count not known. */
  art: GlyphFacts;
}

/** One thing that needs the person, named with why, and the place it is answered. */
export interface Need {
  key: string;
  label: string;
  /** Its standing in a few words. */
  word: string;
  /** Why, in a sentence, read before the press. */
  line: string;
  to: Path;
}

export interface SurfaceModel {
  pose: Pose;
  /** `halo` draws the Bell; a face draws her `<Avatar>` in the Bell's place, at the Bell's size. */
  avatar: AvatarId;
  /** What she is doing, in a line. */
  headline: string;
  /** The pose in words, for a screen reader. */
  poseWord: string;
  waiting: number;
  /** Her window is on the screen: her illustration's press puts it away, else it shows it. */
  windowVisible: boolean;
  reach: readonly Reach[];
  lights: readonly Light[];
  /** In order: the engine, a pending restart, then the accounts. The view shows the first three. */
  needs: readonly Need[];
  canAsk: boolean;
  /** Why the ask box is off, or null. */
  askReason: string | null;
  actions: SurfaceActions;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Mind light's short line: the four standings of `engineFact`, in a light's few words. */
function engineStat(engine: SurfaceSources["engine"]): string {
  switch (engine.standing) {
    case "done":
      return `${engine.label} is ready`;
    case "todo":
      return `${engine.label} is not ready yet`;
    case "missing":
      return `${engine.label} is not ready`;
    case "unknown":
      return engine.checkFailed ? "the engine check failed" : "checking the engine";
  }
}

/** The engine needs the person: it cannot run, or the check of it could not go through. */
const engineNeedsYou = (e: SurfaceSources["engine"]) => e.standing === "missing" || (e.standing === "unknown" && e.checkFailed);

const ENGINE: Path = { root: "mind", item: "engine" };

/** What needs the person, in the order they are told: the engine, a pending restart, the accounts. */
function needsOf(s: SurfaceSources): Need[] {
  const needs: Need[] = [];
  if (engineNeedsYou(s.engine)) {
    needs.push({
      key: "engine",
      label: s.engine.label,
      word: engineStat(s.engine),
      line: `${s.engine.summary.replace(/^./, (c) => c.toUpperCase())}.`,
      to: ENGINE,
    });
  }
  if (s.pendingRestart) {
    const { label, running } = s.pendingRestart;
    needs.push({
      key: "restart",
      label,
      word: "waits for a restart",
      // The Setup module's restart notice, word for word (`restartNotice`).
      line: `${label} is chosen. Athena is still running on ${running}.`,
      to: ENGINE,
    });
  }
  for (const a of s.accounts) {
    if (!a.attention) continue;
    needs.push({ key: `account:${a.id}`, label: a.label, word: a.word, line: a.line, to: { root: "accounts", item: a.id } });
  }
  return needs;
}

/** The apps in a few words, said by the Projects light while there is no project to count. */
function appsStat(apps: number, on: number, openTabs: number): string {
  if (apps === 0) return openTabs > 0 ? `${plural(openTabs, "page")} open` : "no app yet";
  return `${on} of ${plural(apps, "app")} on`;
}

export function selectSurface(s: SurfaceSources): SurfaceModel {
  const onApps = s.apps.filter((a) => a.enabled);
  const connected = s.accounts.filter((a) => a.connected);
  const reach: Reach[] = [
    ...s.apps.map((a) => ({ id: `app:${a.id}`, lit: a.enabled })),
    ...s.accounts.map((a) => ({ id: `account:${a.id}`, lit: a.connected })),
  ];

  const needs = needsOf(s);
  // Each light's glyph facts take its own attention; the rest is the light's numbers.
  const lights: Record<SurfaceRoot, Omit<Light, "root" | "to" | "art"> & { art: Omit<GlyphFacts, "attention"> }> = {
    projects: {
      label: ROOT_LABEL.projects,
      stat: !s.projects.loaded
        ? s.projects.failed
          ? "could not be read"
          : "reading…"
        : s.projects.count === 0
          ? `none yet · ${appsStat(s.apps.length, onApps.length, s.openTabs)}`
          : `${plural(s.projects.count, "project")} · in ${s.projects.active || "core"}`,
      hint: "Where she works: each project keeps its own brief, apps, chores and memory.",
      attention: false,
      art: { filled: s.projects.count, of: s.projects.loaded ? s.projects.count : null },
    },
    chores: {
      label: ROOT_LABEL.chores,
      stat: !s.chores.loaded
        ? s.chores.failed
          ? "could not be counted"
          : "counting…"
        : s.chores.total === 0
          ? "none in this build"
          : `${s.chores.benched} of ${s.chores.total} tested · ${usd(s.chores.foundUsd)} back found`,
      hint: "Chores worth starting, with what they save and the proof.",
      attention: false,
      art: { filled: s.chores.benched, of: s.chores.loaded ? s.chores.total : null },
    },
    accounts: {
      label: ROOT_LABEL.accounts,
      stat:
        s.accounts.length === 0
          ? "none connected"
          : `${connected.length} of ${s.accounts.length} connected`,
      hint: "The accounts she can reach, and what she may do in them.",
      attention: s.accounts.some((a) => a.attention),
      art: { filled: connected.length, of: s.accounts.length },
    },
    voice: {
      label: ROOT_LABEL.voice,
      stat: s.voiceAvailable ? "ready to talk" : s.voiceKnown ? "not set up" : "not known yet",
      hint: "Her voice and how she hears you.",
      attention: false,
      art: { filled: +s.voiceAvailable, of: s.voiceAvailable || s.voiceKnown ? 1 : null },
    },
    mind: {
      label: ROOT_LABEL.mind,
      stat: engineStat(s.engine),
      hint: "The engine she thinks with, and how she looks.",
      attention: engineNeedsYou(s.engine),
      // A check still in flight is not known; one that could not run is a need, and drawn as one.
      art: {
        filled: +(s.engine.standing === "done"),
        of: s.engine.standing === "unknown" && !s.engine.checkFailed ? null : 1,
      },
    },
  };

  const pose = poseOf(s.athena);
  return {
    pose,
    avatar: s.avatar ?? "halo",
    // `pillText` already says "Athena is resting" for the resting pose; only her voice is not its to say.
    headline: pose === "speaking" ? "Athena is speaking" : pillText(s.athena),
    poseWord: POSE_WORDS[pose],
    waiting: s.athena.cards,
    windowVisible: s.windowVisible,
    reach,
    lights: SURFACE_ROOTS.map((root) => {
      const l = lights[root];
      const first = l.attention ? needs.find((n) => n.to.root === root) : undefined;
      return { root, to: first?.to ?? { root }, ...l, art: { attention: l.attention, ...l.art } };
    }),
    needs,
    canAsk: s.inShell,
    askReason: s.inShell ? null : "Her window is only there in the app, so there is no one to hand this to here.",
    actions: s.actions,
  };
}

export const INERT_ACTIONS: SurfaceActions = {
  ask: () => Promise.resolve(),
  summon: () => Promise.resolve(),
  toggle: () => {},
  dive: () => {},
};
