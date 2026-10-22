/**
 * The Playbooks model hook — the one file here that knows a store exists.
 *
 * The playbooks themselves ship with the build and are fetched on first ask (`stores/playbooks.ts`,
 * ADR 0095), so the hook reads that store and asks it to load. What else the module reaches is the clipboard and Athena's composer, for the command, and the Browser's tabs,
 * for a portal or a source — opening one makes the tab and tells the scene, which decides where the
 * person goes (the Chores depth moves to the page).
 */
import { useEffect, useMemo } from "react";

import { athenaOffer } from "@/lib/companion";
import { tabsCreate } from "@/lib/ipc";
import { usePlaybooks } from "@/stores/playbooks";

import { selectPlaybooks, type PlaybookActions, type PlaybooksModel } from "./model";

const BASE = {
  copy: (text: string) => {
    const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard here"));
    return write.catch((error: unknown) => {
      console.error(`[playbooks] copy: ${String(error)}`);
      throw error;
    });
  },
  hand: (text: string, playbook: { id: string; title: string; caseId?: string }) => {
    void athenaOffer(text, playbook).catch((error: unknown) =>
      console.error(`[playbooks] hand: ${String(error)}`),
    );
  },
} satisfies Omit<PlaybookActions, "open">;

const failed = (error: unknown) => console.error(`[playbooks] open: ${String(error)}`);

/**
 * The module's view-model on its own actions. Opening a portal makes the tab and then calls
 * `afterOpen`, because a Rust `browser` selection would show a page under a scene (ADR 0088) and
 * where the person goes next is the scene's to say. Pass a stable function.
 */
export function usePlaybooksModel(afterOpen: (url: string) => void): PlaybooksModel {
  // The shipped set is about 2.7 MB of JSON and loads on first ask, not in the first frame.
  const items = usePlaybooks((s) => s.items);
  // A failed load is said, not spun: the set is no longer on its way, so it is not "loading".
  const problem = usePlaybooks((s) => s.problem);
  useEffect(() => void usePlaybooks.getState().load(), []);
  return useMemo(
    () =>
      selectPlaybooks(
        items ?? [],
        { ...BASE, open: (url) => void tabsCreate(url).then(() => afterOpen(url)).catch(failed) },
        items === null && problem === null,
        problem,
      ),
    [items, problem, afterOpen],
  );
}
