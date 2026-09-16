"use client";

/**
 * THE SECOND AXIS, PUBLISHED — how a variant tells the shell what its views are.
 *
 * `variants/contract.ts` is FROZEN and its props carry the level model, the lens and the pane; it
 * carries no view, on purpose, because a view is a variant's own business (archify has two
 * arrangements, another variant may have none, a third may have seven). But two things outside the
 * stage still need to know: the mast, which draws the switcher, and `set_view`, which an agent
 * calls. `VariantMeta.views` answers *statically* — the names, read off the lazily imported module
 * before anything is mounted. This module answers *live*: which one is current, what it is called,
 * and how to ask for another.
 *
 * IT IS A CHANNEL, NOT A MODEL, and that is the archify practice (study §4: "viewer modules read
 * only the DOM's semantic attributes, never a parallel graph"). The shell never keeps a copy of a
 * variant's view state; it reads what the mounted variant published this render and asks for a
 * change through the callback that variant supplied. A variant that publishes nothing gets a mast
 * with no view switcher and a `set_view` that says so, which is the honest answer and not an error.
 *
 * HOW A VARIANT OPTS IN — two lines, no import from the shell's internals:
 *
 *     import { usePublishViews } from "../viewBus";
 *     usePublishViews({ views: MY_VIEWS, current: view, onSet: setView });
 *
 * `[data-atlas-view]` on the app root mirrors the current view for the capture script and for any
 * agent reading the DOM, which is the same reason `[data-level]` and `[data-band]` are there.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

/** What a variant says about one of its views. Only `id` and `label` are required. */
export interface ViewDescriptor {
  id: string;
  label: string;
  /** One line: what this arrangement is an argument about. */
  note?: string;
  /** What a run means in this view, for a legend or a tool. */
  runs?: string;
}

export interface PublishedViews {
  views: readonly ViewDescriptor[];
  current: string | null;
  /** Null when the mounted variant has no views, or has not published yet. */
  set: ((id: string) => void) | null;
}

const EMPTY: PublishedViews = { views: [], current: null, set: null };

let published: PublishedViews = EMPTY;
const listeners = new Set<() => void>();

function announce(next: PublishedViews) {
  published = next;
  for (const cb of listeners) cb();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The live publication. Pure; safe to call from a tool handler. */
export const readViews = (): PublishedViews => published;

/** Ask the mounted variant for a view. `false` when it has none, or does not know that one. */
export function requestView(id: string): boolean {
  const { views, set } = published;
  if (!set || !views.some((v) => v.id === id)) return false;
  set(id);
  return true;
}

/** Variant side. Publishes while mounted and clears on unmount, so the mast never lies. */
export function usePublishViews(next: {
  views: readonly ViewDescriptor[];
  current: string;
  onSet: (id: string) => void;
}): void {
  const { views, current, onSet } = next;
  useEffect(() => {
    announce({ views, current, set: onSet });
    return () => announce(EMPTY);
  }, [views, current, onSet]);
}

/** Shell side. */
export function useVariantViews(): PublishedViews {
  const views = useSyncExternalStore(subscribe, readViews, () => EMPTY);
  const set = useCallback((id: string) => {
    requestView(id);
  }, []);
  return { views: views.views, current: views.current, set: views.set ? set : null };
}
