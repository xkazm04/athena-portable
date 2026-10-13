/**
 * The Playbooks model hook — the one file here that knows a store exists.
 *
 * The playbooks themselves need no store: they ship in the bundle (`lib/playbooks.ts`). What the
 * module reaches is the clipboard and Athena's composer, for the command, and the Browser's tabs,
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
    void navigator.clipboard?.writeText(text).catch((error: unknown) => {
      console.error(`[playbooks] copy: ${String(error)}`);
    });
  },
  hand: (text: string, playbook: { id: string; title: string }) => {
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
  useEffect(() => void usePlaybooks.getState().load(), []);
  return useMemo(
    () =>
      selectPlaybooks(
        items ?? [],
        { ...BASE, open: (url) => void tabsCreate(url).then(() => afterOpen(url)).catch(failed) },
        items === null,
      ),
    [items, afterOpen],
  );
}
