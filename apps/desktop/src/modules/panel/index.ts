/**
 * The Panel module's `ModuleEntry` — the one file in this directory that knows a store exists.
 *
 * Five stores meet here and none of them is started here: `src/app.tsx` starts them, because the
 * focused page's tools, the origin's trust and the daemon's health all have to stay true while
 * the user is looking at another module (README section 3.5). A module's `Live` may read a store;
 * it may never start one.
 *
 * The one thing this file fetches is a **capture**. A decision that carries a `captureId` is a
 * proposal the shell photographed the page for, and the PNG is a `captures` row rather than
 * something the daemon streams — so it is read back here, once per id, and handed to the view as
 * a data URL. The view stays a pure function of its view-model, which is what lets the preview
 * harness render the card with no shell at all.
 */
import { createElement, useEffect, useMemo, useRef, useState } from "react";

import type { CaptureRow } from "@/lib/store";
import { storeGet } from "@/lib/store";
import type { ModuleEntry } from "@/modules/types";
import { useDaemon } from "@/stores/daemon";
import { useOrigins } from "@/stores/origins";
import { useRun, runActions } from "@/stores/run";
import { useTabs } from "@/stores/tabs";
import { useTools } from "@/stores/tools";

import { fixtureIds, fixtures } from "./fixtures";
import { selectPanel, type PanelActions, type PanelPage } from "./model";
import PanelView from "./view";

function Live() {
  const status = useRun((s) => s.status);
  const transcript = useRun((s) => s.transcript);
  const pendingDecision = useRun((s) => s.pendingDecision);
  const lastError = useRun((s) => s.lastError);
  const conversationId = useRun((s) => s.conversationId);
  const tools = useRun((s) => s.tools);

  const tabs = useTabs((s) => s.tabs);
  const byTab = useTools((s) => s.byTab);
  const records = useOrigins((s) => s.records);
  const health = useDaemon((s) => s.health);
  const daemonError = useDaemon((s) => s.lastError);
  const engine = useDaemon((s) => s.engine);
  const restart = useDaemon((s) => s.restart);

  const page = useMemo(() => pageOf(tabs.find((t) => t.focused) ?? null), [tabs]);
  const entry = page ? byTab[page.tabId] : undefined;
  const record = page ? records[page.origin] : undefined;

  const captures = useCaptures(pendingDecision?.captureId ?? null);

  const actions: PanelActions = useMemo(() => {
    const report = (what: string) => (e: unknown) => console.error(`[panel] ${what}: ${String(e)}`);
    return {
      send: (message) => void runActions.send(message).catch(report("send")),
      answer: (approvalId, choice) =>
        void runActions.answer(approvalId, choice).catch(report("answer")),
      setOverride: (origin, tool, cls) =>
        void runActions.setOverride(origin, tool, cls).catch(report("override")),
      clear: () => runActions.clear(),
      // The daemon is the shell's process; the only thing this surface can do about an offline
      // one is ask for it again on the engine it is already configured with.
      reconnect: () => void restart(engine).catch(report("reconnect")),
    };
  }, [engine, restart]);

  const model = useMemo(
    () =>
      selectPanel({
        status,
        transcript,
        pendingDecision,
        lastError,
        conversationId,
        tools,
        page,
        bridge: entry
          ? { transport: entry.transport, problem: entry.problem, asking: entry.asking }
          : page
            ? { transport: null, problem: null, asking: true }
            : null,
        trust: page
          ? {
              origin: page.origin,
              enabled: record?.enabled ?? false,
              known: Boolean(record),
              overrides: record?.overrides ?? {},
            }
          : null,
        daemonReady: health === "ready",
        daemonProblem: health === "ready" ? null : daemonError || health,
        captures,
        actions,
      }),
    [
      status,
      transcript,
      pendingDecision,
      lastError,
      conversationId,
      tools,
      page,
      entry,
      record,
      health,
      daemonError,
      captures,
      actions,
    ],
  );

  return createElement(PanelView, { model });
}

/**
 * Read one capture's pixels back, once per id, and keep what has been read for this visit.
 *
 * A miss is kept as a miss: an id whose row has been swept by the LRU (c24) never resolves, and a
 * surface that retried it on every render would ask the store for a row that is gone, forever.
 */
function useCaptures(id: string | null): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // A ref rather than state: which ids have been asked for is not something anything renders,
  // and writing it as state would be a second render on the way to the one that matters.
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!id || asked.current.has(id)) return;
    asked.current.add(id);
    void storeGet<CaptureRow>("captures", id)
      .then((row) => {
        if (row?.png) setUrls((current) => ({ ...current, [id]: `data:image/png;base64,${row.png}` }));
      })
      .catch((e: unknown) => console.error(`[panel] capture ${id}: ${String(e)}`));
  }, [id]);

  return urls;
}

function pageOf(tab: { id: number; title: string; url: string } | null): PanelPage | null {
  if (!tab) return null;
  let host = tab.url;
  let origin = tab.url;
  try {
    const url = new URL(tab.url);
    host = url.host || tab.url;
    origin = url.origin;
  } catch {
    // `about:blank` and anything else `URL` refuses: the address is its own host and origin, which
    // is what the origins table will key on anyway.
  }
  return { tabId: tab.id, title: tab.title || tab.url, url: tab.url, host, origin };
}

export const entry: ModuleEntry = {
  id: "panel",
  label: "Panel",
  blurb: "The conversation with Athena, the page's own tools, and the gate between them.",
  fixtureIds,
  preview: (fixture) => createElement(PanelView, { model: fixtures[fixture] ?? fixtures.typical }),
  Live,
};
