/**
 * The Apps depth, as the running app uses it — README section 3.4 and 3.5, ADR 0087, 0088, 0089.
 *
 * With `live-view.tsx`, one of the two files here that know a store exists. The Browser module's
 * own hook supplies the model and the actions; this adds what a depth needs (the tools the open
 * pages registered, the classes the person pinned) and one behaviour of its own: an app opened or
 * registered from the scene moves the depth to its page once the tab exists, so the page shape is
 * never asked for with nothing to show. The view is a lazy chunk, fetched when the depth is first
 * entered, and it joins the Projects in there (ADR 0225), so the spaces store stays off the first
 * frame. Also the page's band: the tab strip, the address field and the tools pill, the 40px under
 * the bar that a native page webview leaves to the chrome (`layout.rs`).
 */
import { createElement, lazy, Suspense, useMemo } from "react";

import type { Labeller, Path } from "@/depth/model";
import { useDepth } from "@/depth/store";
import { useBrowserModel } from "@/modules/browser";
import type { LiveScene, SceneProps } from "@/scenes/types";
import { useOrigins } from "@/stores/origins";
import { useTools } from "@/stores/tools";

import { itemLabel, itemOfTab, pagePath, selectApps, type AppsModel } from "./model";
import { StripView } from "./strip";

const AppsView = lazy(() => import("./live-view"));

/** The tools and pins the Browser module's model does not carry, joined onto it. */
function useAppsModel(go: SceneProps["go"]): AppsModel {
  const browser = useBrowserModel({ onShown: (origin) => go(pagePath(origin)) });
  const byTab = useTools((s) => s.byTab);
  const records = useOrigins((s) => s.records);
  return useMemo(() => {
    const pins = Object.fromEntries(Object.entries(records).map(([origin, row]) => [origin, row.overrides]));
    return selectApps(browser, { byTab, pins });
  }, [browser, byTab, records]);
}

function Live({ path, go }: SceneProps) {
  const model = useAppsModel(go);
  const waiting = createElement("div", { className: "depth-pending typo-caption", role: "status" }, "Opening…");
  return createElement(Suspense, { fallback: waiting }, createElement(AppsView, { model, path, go }));
}

/** What a place under Apps is called in the breadcrumb. */
export function labelOf(model: AppsModel, path: Path): string | undefined {
  if (path.root !== "apps") return undefined;
  if (path.sub?.kind === "page") return "Page";
  if (path.sub?.kind === "tool") return path.sub.arg;
  return path.item === undefined ? undefined : itemLabel(model, path.item);
}

function useLabeller(): Labeller {
  const browser = useBrowserModel();
  const byTab = useTools((s) => s.byTab);
  const model = useMemo(() => selectApps(browser, { byTab, pins: {} }), [browser, byTab]);
  return (path) => labelOf(model, path);
}

/** The band above a page: the Browser module's own strip, on the live stores. */
function Band() {
  const browser = useBrowserModel();
  // Moving between tabs moves the depth with them, so the crumbs and Rise name the page on screen.
  const model = useMemo(
    () => ({
      ...browser,
      actions: {
        ...browser.actions,
        focus: (id: number) => {
          browser.actions.focus(id);
          const tab = browser.tabs.find((t) => t.id === id);
          if (tab) useDepth.getState().go(pagePath(itemOfTab(tab)));
        },
      },
    }),
    [browser],
  );
  return createElement(StripView, { model });
}

export const live: LiveScene = { root: "apps", Live, useLabeller, Band };
