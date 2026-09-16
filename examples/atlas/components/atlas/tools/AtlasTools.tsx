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
 * ROUND 4 ADDED ONE AND REMOVED ONE.
 *
 *   + `set_view` — N arrangements of one drawing is a property of the surface an agent must be
 *     able to read and set, or it cannot describe what a reader is looking at. AUTO for the same
 *     reason `set_lens` is: it changes a way of looking, is reversible by calling it again, and
 *     reaches nothing outside the page.
 *   − `play_turn` — round 3's turn was a light on a clock and the tool started and stopped it.
 *     The turn is now a path drawn all at once with twelve discrete stops, so there is nothing to
 *     play; `set_turn` still moves the step and `read_turn` still answers the whole script. A tool
 *     whose subject no longer exists is worse than a missing one, because an agent will call it.
 *
 * ROUND 5 ADDED `set_variant`; ROUND 6 REMOVED IT, by the same rule that removed `play_turn`.
 * The owner's verdict kept `archify-lanes` and deleted the other two, so `VARIANTS` has one entry
 * and the tool's enum had one value. A tool that can only be called with the answer it would have
 * given is not a capability — it is a sentence, and `read_view` already says it: every projection
 * in `tools/read.ts` names the variant before it names anything else. Keeping a one-value enum
 * would advertise a choice an agent cannot make and would cost a call to discover that. So the
 * tool is gone and the FACT stayed, which is the opposite trade from round 4's `play_turn` only in
 * appearance: both times the subject disappeared and the tool went with it.
 *
 * The mechanism underneath is untouched — `?variant=archify-lanes`, the lazy mount, the
 * placeholder — so the day a second drawing lands, `set_variant` comes back with a real enum.
 *
 * `read_turn` / `set_turn` are NOT here and never were: they are registered by whichever variant
 * tells the turn (`variants/archify-lanes/Tools.tsx`), because a tool the shell registers cannot
 * answer a fact only a stage holds.
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

import type { VariantSlug } from "../variants/contract";
import { readViews, requestView } from "../variants/viewBus";

import {
  CONCEPT_KINDS,
  componentRead,
  conceptsRead,
  lensRead,
  systemRead,
  variantRow,
  viewDetail,
} from "./read";

export function AtlasTools({
  nav,
  lens,
  lensId,
  setLens,
  variant,
  metaViews,
}: {
  nav: ZoomNav;
  lens: Lens;
  lensId: string | null;
  setLens: (id: string | null) => void;
  variant: VariantSlug;
  /** `VariantMeta.views` of the mounted variant — the enum `set_view` advertises. */
  metaViews: readonly string[];
}) {
  /* The LIVE half of the second axis: whatever the mounted variant published this render. Read
     through the bus rather than kept here, so the shell never holds a stale copy of a variant's
     own state (`variants/viewBus.ts`). */
  const currentView = () => {
    const live = readViews();
    return live.views.find((v) => v.id === live.current) ?? null;
  };

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
    detail: () => viewDetail(nav.state.focus, lensId, variant, currentView()),
  });

  useWebMCPTool({
    name: "set_view",
    description:
      "Choose which arrangement the drawing is in. A view is the variant's own second axis, not the app's: the lanes drawing has two (lanes, the four owners as rows and the six moments as columns; turn, the same twelve nodes with the turn's own path made the primary reading order) and re-arranges the same nodes between them, keeping the level, the open phase and the lens. A variant may have none, in which case this tool says so rather than failing. Call with no argument to read the current arrangement and what else is available.",
    parameters: [
      {
        name: "view",
        type: "string",
        required: false,
        enum: [...metaViews],
        description: "The arrangement. Omit to read the current one without changing it.",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ view: asked }) => {
      const live = readViews();
      /* The answer names the view the tool is LEAVING the surface in, which after a successful
         request is the one asked for — the bus has not re-rendered yet inside this handler, so
         reading it back here would answer the previous view and an agent would believe the call
         had failed. */
      const answer = (changed: boolean, id: string | null = live.current) => ({
        ok: true as const,
        variant: variantRow(variant),
        view: live.views.find((v) => v.id === id) ?? null,
        changed,
        available: live.views.map((v) => ({ id: v.id, label: v.label, shows: v.note ?? null })),
        focus: nav.state.focus,
      });
      if (asked === undefined || asked === null || asked === "") return answer(false);
      const wanted = String(asked);
      if (live.views.length === 0) {
        return {
          ok: false as const,
          error: `The ${variantRow(variant).label} variant draws one arrangement and has no views to switch between.`,
          variant: variantRow(variant),
          hint: "read_view names the drawing and everything else that is true of this level.",
        };
      }
      if (wanted === live.current) return answer(false);
      if (!requestView(wanted)) {
        return {
          ok: false as const,
          error: `No view named ${wanted} in the ${variantRow(variant).label} variant.`,
          available: live.views.map((v) => v.id),
        };
      }
      return answer(true, wanted);
    },
    deps: [variant, metaViews, nav.state.focus],
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

  return null;
}
