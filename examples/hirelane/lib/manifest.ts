/**
 * The capability manifest: every tool this app registers, with its parameters and its class
 * (design 5.1, README section 3.3).
 *
 * It used to be two half-manifests inside two React components, and they were never mounted
 * together, so neither one had to be complete. The demo journey mounts both sets on the one
 * shipped route, which makes the union the thing that has to be true — and a union that lives
 * in two `.tsx` files cannot be read by a test, because a test cannot parse JSX.
 *
 * So the list moved here: no React, no server, no JSX. Three consumers read it and none of them
 * re-types it — `components/HostCapabilities.tsx` and `components/board/tools/BoardTools.tsx`
 * spread the parameters and the flags into their registrations, `components/board/shell/Foot.tsx`
 * prints the class of every row, and `test/tools.test.ts` asserts the annotations a browser agent
 * will actually read.
 *
 * The class is never typed out. `isAuto` applies the manifest's own rule, and
 * `annotationsFor` in `@athena/demo-kit/webmcp` turns the same two flags into the standard
 * `readOnlyHint` / `consequentialHint` pair.
 */
import {
  DECISION_STAGES,
  MOVE_STAGES,
  REJECTION_TEMPLATES,
  STAGES,
  VIEWS,
} from "./constants";

/** A parameter, in the shape `useWebMCPTool` takes. Enums are mandatory for anything that
 *  addresses UI (design 5.1). */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  enum?: readonly string[];
  required?: boolean;
  description?: string;
}

export interface Capability {
  name: string;
  /** Can the app put this back? */
  reversible: boolean;
  /** `none` = UI only, `data` = writes app data, `external` = reaches the outside world. */
  sideEffects: "none" | "data" | "external";
  parameters: readonly ToolParameter[];
}

/** The manifest's rule, in one place: AUTO is reversible and stays inside the app. */
export function isAuto(capability: Pick<Capability, "reversible" | "sideEffects">): boolean {
  return capability.reversible && capability.sideEffects !== "external";
}

const APPLICANT_ID: ToolParameter = {
  name: "applicant_id",
  type: "string",
  required: true,
  description: "An applicant id, from read_applicants, read_view or search_candidates",
};

const ROLE_ID: ToolParameter = {
  name: "role_id",
  type: "string",
  required: true,
  description: "A role id from read_view: role_backend or role_designer",
};

/**
 * The acts: scoring, notes, moves, decisions, slots, and the two that reach a person.
 *
 * Three of them are GATED and all three are gated for the same reason — they cannot be taken
 * back. `decide_stage` ends someone's process; `send_scheduling_email` and `send_rejection` leave
 * the building. Nothing else on this list becomes GATED by being made more useful.
 */
export const SHIPPED_CAPABILITIES = [
  {
    name: "navigate",
    reversible: true,
    sideEffects: "none",
    parameters: [
      { name: "view", type: "string", enum: VIEWS, required: true, description: "View to open" },
    ],
  },
  {
    name: "score_against_rubric",
    reversible: true,
    sideEffects: "data",
    parameters: [APPLICANT_ID],
  },
  {
    name: "add_note",
    reversible: true,
    sideEffects: "data",
    parameters: [
      APPLICANT_ID,
      { name: "text", type: "string", required: true, description: "The note, in plain words" },
    ],
  },
  {
    name: "move_stage",
    reversible: true,
    sideEffects: "data",
    parameters: [
      APPLICANT_ID,
      { name: "stage", type: "string", enum: MOVE_STAGES, required: true },
    ],
  },
  {
    name: "decide_stage",
    reversible: false,
    sideEffects: "data",
    parameters: [
      APPLICANT_ID,
      { name: "stage", type: "string", enum: DECISION_STAGES, required: true },
    ],
  },
  { name: "propose_slots", reversible: true, sideEffects: "data", parameters: [APPLICANT_ID] },
  {
    name: "send_scheduling_email",
    reversible: false,
    sideEffects: "external",
    parameters: [
      APPLICANT_ID,
      {
        name: "slot_id",
        type: "string",
        required: true,
        description: "A held or open slot id, from propose_slots or read_view",
      },
    ],
  },
  {
    name: "send_rejection",
    reversible: false,
    sideEffects: "external",
    parameters: [
      APPLICANT_ID,
      { name: "template", type: "string", enum: REJECTION_TEMPLATES, required: true },
    ],
  },
] as const satisfies readonly Capability[];

/**
 * The board's own layer: four zoom verbs, a search, a filter, and the two reads the demo journey
 * asks for. Every one of them reads or moves the view, so every one is AUTO — and that is a claim
 * the foot prints, not a coincidence.
 *
 * `read_applicants` and `read_shortlist` are here rather than beside the acts because they read
 * the board's own payload, which is the one dataset this route holds.
 */
export const BOARD_CAPABILITIES = [
  { name: "read_view", reversible: true, sideEffects: "none", parameters: [] },
  {
    name: "open_group",
    reversible: true,
    sideEffects: "none",
    parameters: [
      { name: "id", type: "string", required: true, description: "The group's id, from read_view" },
    ],
  },
  {
    name: "open_item",
    reversible: true,
    sideEffects: "none",
    parameters: [
      { name: "id", type: "string", required: true, description: "The candidate's id" },
      { name: "group", type: "string", description: "Optional group id to look in" },
    ],
  },
  { name: "zoom_out", reversible: true, sideEffects: "none", parameters: [] },
  {
    name: "search_candidates",
    reversible: true,
    sideEffects: "none",
    parameters: [
      {
        name: "text",
        type: "string",
        description: "Matched against name, headline, summary and their written answer",
      },
      { name: "role", type: "string", description: "A role id from read_view, or omit for both" },
      {
        name: "employer",
        type: "string",
        description: "Current employer, by company name or email domain",
      },
      { name: "stage", type: "string", enum: STAGES, description: "One pipeline stage" },
      {
        name: "scored_at_least",
        type: "number",
        description: "Weighted 0-4 floor; scored candidates only",
      },
      {
        name: "scored_at_most",
        type: "number",
        description: "Weighted 0-4 ceiling; scored candidates only",
      },
      { name: "arguable", type: "boolean", description: "Only the ones a person flagged" },
      { name: "unscored", type: "boolean", description: "Only the ones nobody has scored yet" },
    ],
  },
  {
    name: "set_filter",
    reversible: true,
    sideEffects: "none",
    parameters: [
      { name: "role", type: "string", description: "A role id from read_view, or 'all'" },
      { name: "arguable", type: "boolean", description: "Show only the candidates a person flagged" },
    ],
  },
  {
    name: "read_applicants",
    reversible: true,
    sideEffects: "none",
    parameters: [
      ROLE_ID,
      { name: "stage", type: "string", enum: STAGES, description: "One pipeline stage, or omit for all five" },
      { name: "borderline", type: "boolean", description: "Only the applicants a person flagged as borderline" },
    ],
  },
  {
    name: "read_shortlist",
    reversible: true,
    sideEffects: "none",
    parameters: [ROLE_ID],
  },
] as const satisfies readonly Capability[];

/**
 * What the shipped route actually puts on `document.modelContext`: both sets, mounted together.
 *
 * They used to be mutually exclusive — `HostCapabilities` returned null on the board — because the
 * board was one of several directions and handing it a second overlapping set would have been two
 * vocabularies for one surface. There is one route now, and the journey needs to read the pipeline
 * AND act on it, so the two sets are one register. There is no name collision between them: the
 * acts are verbs on a person, the board's are verbs on the view.
 */
export const CAPABILITIES = [
  ...SHIPPED_CAPABILITIES,
  ...BOARD_CAPABILITIES,
] as const satisfies readonly Capability[];

/** Every tool name this app registers, as a type, so a registration cannot name a tool that
 *  is not on the manifest. */
export type CapabilityName = (typeof CAPABILITIES)[number]["name"];

/**
 * One manifest row, in the shape `useWebMCPTool` takes.
 *
 * The two registration files spread this and add only a description and a handler, so a
 * parameter widened here is widened everywhere, and a parameter that is NOT here cannot be passed
 * to anything. The enum arrays are copied because the kit's `HostParameter` wants a mutable one;
 * the manifest keeps its own readonly.
 */
export interface RegisteredParameter extends Omit<ToolParameter, "enum"> {
  /** Mutable, because the kit's `HostParameter` is. The manifest keeps its own readonly. */
  enum?: string[];
}

export function registration(name: CapabilityName): {
  parameters: RegisteredParameter[];
  reversible: boolean;
  sideEffects: Capability["sideEffects"];
} {
  const all: readonly Capability[] = CAPABILITIES;
  const found = all.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not on the capability manifest`);
  return {
    parameters: found.parameters.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.enum ? { enum: [...p.enum] } : {}),
      ...(p.required === undefined ? {} : { required: p.required }),
      ...(p.description === undefined ? {} : { description: p.description }),
    })),
    reversible: found.reversible,
    sideEffects: found.sideEffects,
  };
}

/**
 * Words that may not name a column or a parameter in this app (README, Bias mitigations).
 *
 * The refusal to "rank them by university" is structural rather than written: there is no such
 * column to read and no such parameter to pass, so there is nothing for a policy to switch off.
 * `test/tools.test.ts` asserts both halves against this list.
 */
export const PROTECTED_ATTRIBUTES = [
  "age",
  "birth",
  "gender",
  "sex",
  "nationality",
  "ethnicity",
  "race",
  "religion",
  "photo",
  "picture",
  "image",
  "avatar",
  "school",
  "university",
  "college",
  "alma_mater",
  "degree",
  "graduation",
  "gpa",
] as const;
