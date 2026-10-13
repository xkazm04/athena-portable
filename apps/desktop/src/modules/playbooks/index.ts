/**
 * The Playbooks module's `ModuleEntry` — the one file here that knows a store exists.
 *
 * The playbooks themselves need no store: they ship in the bundle (`lib/playbooks.ts`). What the
 * module reaches is the clipboard and Athena's composer, for the command, and the Browser's tabs,
 * for a portal or a source — opening one selects the Browser module, as a person would expect.
 */
import { createElement, useMemo } from "react";

import { athenaOffer } from "@/lib/companion";
import { tabsCreate } from "@/lib/ipc";
import { PLAYBOOKS } from "@/lib/playbooks";
import type { ModuleEntry } from "@/modules/types";
import { useShell } from "@/stores/shell";

import { fixtureIds, fixtures, initialFacetFor, initialOpenFor, initialTurnFor } from "./fixtures";
import { selectPlaybooks, type PlaybookActions, type PlaybooksModel } from "./model";
import PlaybooksView from "./view";

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
 * The module's view-model on its own actions. The module bar's Playbooks selects the Browser to
 * show a tab it just made; a console scene must not (a Rust `browser` selection shows a page under
 * a scene, ADR 0088), so it passes `afterOpen`: the tab is made and the scene decides where the
 * person goes next (a no-op stays where they are). Pass a stable function.
 */
export function usePlaybooksModel(options: { afterOpen?: (url: string) => void } = {}): PlaybooksModel {
  const { afterOpen } = options;
  return useMemo(
    () =>
      selectPlaybooks(PLAYBOOKS, {
        ...BASE,
        open: (url) => {
          if (afterOpen === undefined) {
            void useShell.getState().select("browser").then(() => tabsCreate(url)).catch(failed);
          } else {
            void tabsCreate(url).then(() => afterOpen(url)).catch(failed);
          }
        },
      }),
    [afterOpen],
  );
}

function Live() {
  return createElement(PlaybooksView, { model: usePlaybooksModel() });
}

export const entry: ModuleEntry = {
  id: "playbooks",
  label: "Playbooks",
  blurb: "Chores worth real money that only Athena does, each proven on the bench.",
  fixtureIds,
  preview: (fixture) =>
    createElement(PlaybooksView, {
      model: fixtures[fixture] ?? fixtures.typical,
      initialOpen: initialOpenFor(fixture),
      initialFacet: initialFacetFor(fixture),
      initialTurn: initialTurnFor(fixture),
    }),
  Live,
};
