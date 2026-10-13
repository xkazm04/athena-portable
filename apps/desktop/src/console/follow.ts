/**
 * Keeping the depth with what Rust and the tabs do — README section 3.5, ADR 0088.
 *
 * The depth decides the window's shape and tells Rust (`depth/shape`), but two things move the
 * window without asking it: Rust selects a page when the welcome opens a first app, and the
 * focused tab changes under a page (a link opens a window, a tab is closed). The decisions here are
 * pure so each is tested without a window; `useFollowShell` is the thin hook that feeds them events.
 *
 * Deliberately not followed: a tab appearing while the person is in a scene. A background act may
 * open a page, and yanking someone out of the depth they are reading would be worse than the page
 * waiting under the Apps depth, where it is listed.
 */
import { useEffect, useRef } from "react";

import { shapeOf, type Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { onLayoutChanged } from "@/lib/ipc";
import { itemOfTab, pagePath } from "@/scenes/apps/model";
import { useTabs } from "@/stores/tabs";

export interface Focused {
  id: number;
  url: string;
}

/** Rust selected a shape the depth is not in: follow it. Null when the depth already agrees. */
export function followLayout(path: Path, shape: string, focused: Focused | null): Path | null {
  const now = shapeOf(path);
  if (shape === "page" && now === "scene") {
    return focused ? pagePath(itemOfTab(focused)) : { root: "apps" };
  }
  if (shape === "scene" && now === "page") {
    return { root: path.root, item: path.item };
  }
  return null;
}

/**
 * The focused tab changed while a page is showing: name the page now on screen, or, if the last tab
 * closed and there is no page to show, leave the page shape (an empty band is not a place).
 */
export function followFocus(path: Path, previous: number | null, focused: Focused | null): Path | null {
  if (shapeOf(path) !== "page") return null;
  if (focused === null) return { root: "apps" };
  if (focused.id === previous) return null;
  const item = itemOfTab(focused);
  return item === path.item ? null : pagePath(item);
}

export function useFollowShell(): void {
  const focusedTab = useTabs((s) => s.tabs.find((t) => t.focused) ?? null);
  const loaded = useTabs((s) => s.loaded);
  const focused: Focused | null = focusedTab ? { id: focusedTab.id, url: focusedTab.url } : null;
  const previous = useRef<number | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void onLayoutChanged((shape) => {
      const { path, go } = useDepth.getState();
      const tab = useTabs.getState().tabs.find((t) => t.focused);
      const to = followLayout(path, shape, tab ? { id: tab.id, url: tab.url } : null);
      if (to) go(to);
    }).then((un) => (stop = un));
    return () => stop?.();
  }, []);

  useEffect(() => {
    // Before the shell has answered, "no focused tab" means "not asked yet", not "none is open".
    if (!loaded) return;
    const { path, go } = useDepth.getState();
    const to = followFocus(path, previous.current, focused);
    previous.current = focused?.id ?? null;
    if (to) go(to);
  });
}
