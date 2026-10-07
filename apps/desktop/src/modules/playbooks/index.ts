/**
 * The Playbooks module's `ModuleEntry` — the one file here that knows a store exists.
 *
 * The playbooks themselves need no store: they ship in the bundle (`lib/playbooks.ts`). What the
 * module reaches is the clipboard and Athena's composer, for the command, and the Browser's tabs,
 * for a portal or a source — opening one selects the Browser module, as a person would expect.
 */
import { createElement } from "react";

import { athenaOffer } from "@/lib/companion";
import { tabsCreate } from "@/lib/ipc";
import { PLAYBOOKS } from "@/lib/playbooks";
import type { ModuleEntry } from "@/modules/types";
import { useShell } from "@/stores/shell";

import { fixtureIds, fixtures, initialOpenFor } from "./fixtures";
import { selectPlaybooks, type PlaybookActions } from "./model";
import PlaybooksView from "./view";

const ACTIONS: PlaybookActions = {
  copy: (text) => {
    void navigator.clipboard?.writeText(text).catch((error: unknown) => {
      console.error(`[playbooks] copy: ${String(error)}`);
    });
  },
  hand: (text, playbook) => {
    void athenaOffer(text, playbook).catch((error: unknown) =>
      console.error(`[playbooks] hand: ${String(error)}`),
    );
  },
  open: (url) => {
    void useShell
      .getState()
      .select("browser")
      .then(() => tabsCreate(url))
      .catch((error: unknown) => console.error(`[playbooks] open: ${String(error)}`));
  },
};

function Live() {
  return createElement(PlaybooksView, { model: selectPlaybooks(PLAYBOOKS, ACTIONS) });
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
    }),
  Live,
};
