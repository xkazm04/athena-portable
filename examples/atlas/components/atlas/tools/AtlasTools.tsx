"use client";

/**
 * Every capability Atlas offers an agent, in one place.
 *
 * Atlas ships WITHOUT Athena; these are registered and waiting on `document.modelContext` through
 * `@athena/demo-kit/webmcp`, exactly as ledgerbox, hirelane and tidycrm do. A browser agent reads
 * the standard annotations and applies the design 5.1 rule from them.
 *
 * EVERY TOOL HERE IS AUTO, and that is not a convenience. Atlas has no database, writes nothing
 * and reaches nobody: every capability is a read or a move, so `reversible: true` and
 * `sideEffects: "none"` are the honest flags and `reversible && side_effects !== "external"` makes
 * them AUTO. An app never argues a tool out of GATED — this one simply has no tool that earns it.
 *
 * The four verbs of the level model (`read_view`, `open_group`, `open_item`, `zoom_out`) are the
 * kit's `useZoomTools`, so they mean the same thing here as on every other surface. The rest are
 * what only Atlas can answer.
 *
 * ROUND 4 ADDS ONE AND REMOVES ONE.
 *
 *   + `set_view` — four arrangements of one drawing is a property of the surface an agent must be
 *     able to read and set, or it cannot describe what a reader is looking at. AUTO for the same
 *     reason `set_lens` is: it changes a way of looking, is reversible by calling it again, and
 *     reaches nothing outside the page.
 *   − `play_turn` — round 3's turn was a light on a clock and the tool started and stopped it.
 *     The turn is now a path drawn all at once with twelve discrete stops, so there is nothing to
 *     play; `set_turn` still moves the step and `read_turn` still answers the whole script. A tool
 *     whose subject no longer exists is worse than a missing one, because an agent will call it.
 */
import { useZoomTools, useWebMCPTool } from "@athena/demo-kit/webmcp";
import type { ZoomNav } from "@athena/demo-kit/zoom";

import {
  CONCEPTS,
  LAYERS,
  SYSTEMS,
  componentsOf,
  componentsOfLayer,
  systemsOf,
  type Lens,
} from "@/data";
import { LEVELS, NOUNS } from "@/lib/constants";

import { VIEWS, VIEW_META, isView, type ViewId } from "../canvas/plan";
import { TURN } from "../canvas/turn";

import {
  CONCEPT_KINDS,
  componentRead,
  conceptsRead,
  lensRead,
  systemRead,
  turnRead,
  viewDetail,
} from "./read";

export function AtlasTools({
  nav,
  lens,
  lensId,
  setLens,
  view,
  setView,
  stop,
  setStop,
}: {
  nav: ZoomNav;
  lens: Lens;
  lensId: string | null;
  setLens: (id: string | null) => void;
  view: ViewId;
  setView: (next: ViewId) => void;
  stop: number;
  setStop: (index: number) => void;
}) {
  useZoomTools({
    nav,
    levels: LEVELS,
    nouns: NOUNS,
    groups: () =>
      LAYERS.map((l) => ({
        id: l.id,
        label: l.name,
        count: componentsOfLayer(l.id).length,
      })),
    items: (group) =>
      (group === null ? LAYERS : LAYERS.filter((l) => l.id === group)).flatMap((l) =>
        systemsOf(l.id).flatMap((s) =>
          componentsOf(s.id).map((c) => ({
            id: c.id,
            label: `${c.part} · ${c.name} · ${c.file}`,
            group: l.id,
          })),
        ),
      ),
    detail: () => viewDetail(nav.state.focus, lensId, view),
  });

  useWebMCPTool({
    name: "set_view",
    description:
      "Choose which of the four arrangements of the blueprint is on the sheet: layers (the six strata of README 3.1, dependencies running down), turn (README 3.2's twelve stops in order), trust (the six invariants, each a region of the blocks that enforce it), packages (the file tree as nested rectangles). The same blocks move to a new arrangement; the level and the open layer are kept. Call with no argument to read the current view.",
    parameters: [
      {
        name: "view",
        type: "string",
        required: false,
        enum: [...VIEWS],
        description: "The arrangement. Omit to read the current one without changing it.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ view: asked }) => {
      const answer = (id: ViewId, changed: boolean) => ({
        ok: true as const,
        view: { ...VIEW_META[id] },
        changed,
        available: VIEWS.map((v) => ({ id: v, label: VIEW_META[v].label, shows: VIEW_META[v].note })),
        focus: nav.state.focus,
      });
      if (asked === undefined || asked === null || asked === "") return answer(view, false);
      if (!isView(asked)) {
        return {
          ok: false as const,
          error: `No view named ${String(asked)}.`,
          available: [...VIEWS],
        };
      }
      if (asked !== view) setView(asked);
      return answer(asked, asked !== view);
    },
    deps: [view, setView, nav.state.focus],
  });

  useWebMCPTool({
    name: "read_concepts",
    description:
      "The seventeen claims this repository makes: the six invariants of README §2, the four rungs of the onboarding ladder, the four acts of the demo, and three standing decisions. Each carries the section it was read from and how many components enforce it. Pass to set_lens to mark up the sheet.",
    parameters: [
      {
        name: "kind",
        type: "string",
        required: false,
        enum: [...CONCEPT_KINDS],
        description: "Narrow to one kind of claim. Omit for all of them.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ kind }) => conceptsRead(kind),
  });

  useWebMCPTool({
    name: "read_system",
    description:
      "One system — a directory or a package that realises part of a layer — with every component in it, each component's repository path, and the ids open_item takes. Call read_view first for the layer ids, or pass a system id straight from a lens.",
    parameters: [
      {
        name: "id",
        type: "string",
        required: true,
        enum: SYSTEMS.map((s) => s.id),
        description: "The system's id, e.g. sys-catalog.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ id }) => systemRead(id),
  });

  useWebMCPTool({
    name: "read_component",
    description:
      "One module at full depth: what it enforces, the claims it carries, every component that calls it, everything it reaches, the ADRs that decided it, and its path in this repository. This is the same thing the L2 pane shows a reader.",
    parameters: [
      {
        name: "id",
        type: "string",
        required: true,
        description: "The component's id, e.g. cmp-catalog. read_system lists them for one system.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ id }) => componentRead(id),
  });

  useWebMCPTool({
    name: "set_lens",
    description:
      "Mark up the whole atlas with one claim: every component that enforces it, every system and layer above those components. Reversible — call again with a different concept, or with none to clear. Call with no arguments to read the current lens without changing it.",
    parameters: [
      {
        name: "concept",
        type: "string",
        required: false,
        enum: CONCEPTS.map((c) => c.id),
        description: "The concept id from read_concepts. Omit to read; pass \"none\" to clear.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ concept }) => {
      if (concept === undefined || concept === null) return lensRead(lensId);
      const asked = String(concept);
      if (asked === "none" || asked === "") {
        setLens(null);
        return { ...lensRead(null), cleared: true };
      }
      if (!CONCEPTS.some((c) => c.id === asked)) {
        return {
          ok: false as const,
          error: `No concept with id ${asked}.`,
          available: CONCEPTS.map((c) => ({ id: c.id, part: c.part, name: c.name })),
        };
      }
      /* `setLens` toggles, so asking for the concept that is already set would CLEAR it — and a
         tool that answers "set" while clearing is the one answer an agent cannot recover from. */
      if (asked !== lensId) setLens(asked);
      return lensRead(asked);
    },
    deps: [lensId, setLens, lens.concept?.id],
  });

  useWebMCPTool({
    name: "read_turn",
    description:
      "The turn this machine runs, from README section 3.2: every stop in order, the module it happens in, the system and layer it belongs to, the one label the sheet shows there, and the README section it was read from. The gate's stop is the one that waits. Call set_view with 'turn' to put the path on the sheet and set_turn to step it.",
    parameters: [],
    reversible: true,
    sideEffects: "none",
    handler: () => turnRead(stop),
    deps: [stop],
  });

  useWebMCPTool({
    name: "set_turn",
    description:
      "Put the turn's step at one stop. The sheet lights that module's block and the read-out shows its label. Reversible: call again with another stop. Has no effect on which view is on the sheet — call set_view('turn') to see the path.",
    parameters: [
      {
        name: "stop",
        type: "number",
        required: true,
        description: `Which stop, 1 to ${TURN.length}. read_turn lists them.`,
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ stop: asked }) => {
      const n = Number(asked);
      if (!Number.isFinite(n) || n < 1 || n > TURN.length) {
        return {
          ok: false as const,
          error: `No stop ${String(asked)}. The turn has ${TURN.length} stops, numbered from 1.`,
        };
      }
      setStop(n - 1);
      return turnRead(n - 1);
    },
    deps: [setStop],
  });

  return null;
}
