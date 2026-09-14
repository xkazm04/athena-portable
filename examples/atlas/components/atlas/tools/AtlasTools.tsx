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
 * `set_lens` is the only one that changes anything a reader can see, and it changes a way of
 * looking, is reversible by calling it again, and reaches nothing outside the page.
 *
 * The four verbs of the level model (`read_view`, `open_group`, `open_item`, `zoom_out`) are the
 * kit's `useZoomTools`, so they mean the same thing here as on every other surface. The rest are
 * what only Atlas can answer.
 *
 * ROUND 3 ADDS TWO, both AUTO for the same reason as the others — `play_turn` and `set_turn` move
 * the transport, which is a way of looking rather than a change to anything. They exist because
 * the turn is now the app's hero and an agent that cannot drive it cannot see the argument: a
 * capture script, a reviewer's assistant or Athena herself needs to be able to say "stop at the
 * gate" and have the machine show the gate. `set_turn` takes a STOP NUMBER, not a beat, because
 * the beat is an implementation detail of the clock and a stop is a thing README §3.2 names.
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

import { TURN } from "../scene/turn";
import type { Transport } from "../scene/useTurn";

import { CONCEPT_KINDS, componentRead, conceptsRead, lensRead, systemRead, turnRead, viewDetail } from "./read";

export function AtlasTools({
  nav,
  lens,
  lensId,
  setLens,
  transport,
}: {
  nav: ZoomNav;
  lens: Lens;
  lensId: string | null;
  setLens: (id: string | null) => void;
  transport: Transport;
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
    detail: () => viewDetail(nav.state.focus, lensId),
  });

  useWebMCPTool({
    name: "read_concepts",
    description:
      "The seventeen claims this repository makes: the six invariants of README §2, the four rungs of the onboarding ladder, the four acts of the demo, and three standing decisions. Each carries the section it was read from and how many components enforce it. Pass to set_lens to mark up the stack.",
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
      "The turn this machine runs, from README section 3.2: every stop in order, the module it happens in, the one label the scene shows there, and the README section it was read from. The gate's stop is the one that waits. Call set_turn with a stop number to put the light there.",
    parameters: [],
    reversible: true,
    sideEffects: "none",
    handler: () => turnRead(transport.stop),
    deps: [transport.stop],
  });

  useWebMCPTool({
    name: "set_turn",
    description:
      "Put the turn's light at one stop and hold it there, pausing playback. The scene lights that module's block and shows its label. Reversible: call again with another stop, or play_turn to run from here.",
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
    handler: ({ stop }) => {
      const n = Number(stop);
      if (!Number.isFinite(n) || n < 1 || n > TURN.length) {
        return {
          ok: false as const,
          error: `No stop ${String(stop)}. The turn has ${TURN.length} stops, numbered from 1.`,
        };
      }
      transport.goTo(n - 1);
      return turnRead(n - 1);
    },
    deps: [transport.goTo],
  });

  useWebMCPTool({
    name: "play_turn",
    description:
      "Run the turn from where the light is, or pause it. Reversible in both directions; changes nothing but what is moving on screen.",
    parameters: [
      {
        name: "action",
        type: "string",
        required: false,
        enum: ["play", "pause", "rewind"],
        description: "Default play. rewind puts the light back at the first stop and pauses.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ action }) => {
      const verb = action === undefined || action === null ? "play" : String(action);
      if (verb === "pause") transport.pause();
      else if (verb === "rewind") transport.rewind();
      else transport.play();
      return { ...turnRead(transport.stop), playing: verb === "play" };
    },
    deps: [transport.play, transport.pause, transport.rewind, transport.stop],
  });

  return null;
}
