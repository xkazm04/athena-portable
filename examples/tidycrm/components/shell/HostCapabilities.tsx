"use client";

/**
 * Every capability tidycrm offers an agent, in one place (design 4.6.4).
 *
 * The app ships without Athena; these are registered and waiting, on `document.modelContext`
 * rather than in a chat the app hosts itself. A browser agent reads the standard annotations and
 * applies the design 5.1 rule — `merge_contacts`, `delete_contacts` and `undo` are the three that
 * come back GATED, which is the whole point of this domain.
 *
 * The class is never this file's opinion. Design 5.1 decides it from two declared flags, and
 * `HostTool.default_class` (src/athena/contracts/manifest.py) is the authority: AUTO iff
 * `reversible` and `side_effects !== "external"`, GATED otherwise, whatever the host would
 * prefer. So each entry below declares the flags its own server action justifies and takes
 * whatever class falls out — including `undo`, whose action writes an activity row the kit marks
 * `reversible: false` (demo-kit activity/index.ts), because nothing here can put an undo back.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useWebMCPTool } from "@athena/demo-kit/webmcp";
import { useToast } from "@athena/demo-kit/ui";
import {
  MAX_DOMAINS,
  MAX_IDS,
  SEGMENTS,
  VIEWS,
  VIEW_PATHS,
  type Segment,
  type View,
} from "@/lib/constants";
import { RULES, type NormalizeRule } from "@/lib/normalize";
import type { DefectCounts } from "@/lib/types";
import {
  deleteAction,
  exportSummaryAction,
  flagStaleAction,
  mergeAction,
  normalizeAction,
  listPairsAction,
  previewCompanyAction,
  previewMergeAction,
  previewNormalizeAction,
  readConflictsAction,
  resolveCompanyAction,
  resolvePairAction,
  undoAction,
} from "@/app/actions";

/** The two reviewer verdicts that are not a merge (lib/mutations.ts, `resolvePair`). */
const VERDICTS = ["kept_both", "skipped"] as const;
type Verdict = (typeof VERDICTS)[number];

function asIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).slice(0, MAX_IDS);
}

function asRules(value: unknown): NormalizeRule[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter((r): r is NormalizeRule => (RULES as readonly string[]).includes(r));
}

function asVerdict(value: unknown): Verdict | null {
  const v = String(value);
  return (VERDICTS as readonly string[]).includes(v) ? (v as Verdict) : null;
}

export function HostCapabilities({ counts }: { counts: DefectCounts }) {
  // There is one screen now (app/page.tsx), so there is one surface. This used to branch: the
  // eight tools that act on the contact list stood down on `/v/blocks`, which brought its own
  // seven, and only `navigate`, `export` and `read_state` were registered everywhere. With the
  // sheet at the root the branch would have stood the whole write surface down permanently. The
  // two modules still register disjoint names — nothing here collides with `components/blocks/
  // tools/BlocksTools.tsx`, whose tools look and move and never write.
  return (
    <>
      <SharedCapabilities counts={counts} />
      <ShippedCapabilities />
    </>
  );
}

/** Where the app is, what it holds, and what it would write out. */
function SharedCapabilities({ counts }: { counts: DefectCounts }) {
  const router = useRouter();
  const params = useSearchParams();
  const segment = (params.get("segment") ?? "all") as Segment;

  useWebMCPTool({
    name: "navigate",
    description:
      "Open one of the app's views. `blocks` is The Blocks - the survey sheet, read at three depths, at the root of the app, and the screen every other tool here is about.",
    parameters: [
      { name: "view", type: "string", enum: [...VIEWS], required: true, description: "View to open" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ view }) => {
      const target = String(view) as View;
      const path = VIEW_PATHS[target];
      if (!path) return `Unknown view ${target}.`;
      router.push(path);
      return `Opened ${target}.`;
    },
  });

  useWebMCPTool({
    name: "export",
    description:
      "Write one segment out as CSV and report what the cleanup did to it. Downloads the file, and returns the row count, the counts of what was normalised, merged and settled, the companies the exported rows belong to, and a `title` and `markdown` block ready to be appended to a page elsewhere. `clients` is the campaign audience - the contacts on the studio's client domains; every company is listed with its domain, so a caller who has a reason to leave one of them out can see which rows that is. The export itself is recorded in the activity log, which is why this is not a read-only tool.",
    parameters: [
      { name: "segment", type: "string", enum: [...SEGMENTS], required: true, description: "Segment to write out" },
    ],
    reversible: true,
    // `data`, not `none`: /api/export writes a non-reversible activity row on
    // every call (the route's own note: reading is not a mutation, but it is
    // still provenance). `none` + reversible is what the kit turns into
    // readOnlyHint, a standing promise to any browser agent that the tool
    // changes nothing. The class is unaffected - a reversible data tool is
    // still not consequential, so export stays AUTO.
    sideEffects: "data",
    handler: async ({ segment: which }) => {
      const target = String(which);
      if (!(SEGMENTS as readonly string[]).includes(target)) return `Unknown segment ${target}.`;
      // A file download, not a page navigation: the route answers with Content-Disposition, so the
      // router must not be involved or the CSV would be handed to the client-side navigation.
      const link = document.createElement("a");
      link.href = `/api/export?segment=${encodeURIComponent(target)}`;
      link.download = `tidycrm-${target}.csv`;
      link.click();
      // The file is the artifact; this is the half a model can read. A tool that answered
      // "Exporting all." left the agent with nothing to say about what it had just done, so the
      // close of the campaign had to be narrated from memory - which is how a summary acquires
      // figures nobody counted.
      const summary = await exportSummaryAction(target as Segment);
      return { ...summary, file: `tidycrm-${target}.csv` };
    },
  });

  /*
   * WebMCP has no separate readable channel, so what used to be published as
   * ambient context is a read-only tool the agent calls when it wants the
   * answer. That is the better shape anyway: a readable is stringified into
   * every prompt whether it is needed or not, while a tool is asked for.
   */
  useWebMCPTool({
    name: "read_state",
    description:
      "The defect segment the contact list is filtered to, and live counts per defect kind including the state of the merge queue.",
    reversible: true,
    sideEffects: "none",
    handler: () => ({ segment, counts }),
    deps: [segment, counts],
  });

  return null;
}

/**
 * Everything that acts on the contact list, and the reads the acts need first.
 *
 * Every server action in `app/actions.ts` is reachable from exactly one tool. That is the property
 * `test/tools.test.ts` pins, and it is not cosmetic: the surface used to carry both irreversible
 * verdicts and neither reversible one, so the only verb that could close a merge queue pair was
 * `merge_contacts`.
 */
function ShippedCapabilities() {
  const { toast } = useToast();

  useWebMCPTool({
    name: "normalize_fields",
    description:
      "Apply formatting rules to contacts. Every change is written to the revision log, so it can be undone per record.",
    parameters: [
      { name: "ids", type: "string[]", required: true, maxItems: MAX_IDS, description: "Contact ids" },
      { name: "rules", type: "string[]", required: true, enum: [...RULES], maxItems: RULES.length, description: "Rules to apply" },
    ],
    reversible: true,
    sideEffects: "data",
    handler: async ({ ids, rules }) => {
      const result = await normalizeAction(asIds(ids), asRules(rules));
      toast(result.error ?? result.summary, result.ok ? "success" : "error");
      return result.error ?? result.summary;
    },
  });

  /* `preview_merge`'s twin (lib/mutations.ts, `planNormalize`): the dry run of the tool above. */
  useWebMCPTool({
    name: "preview_normalize",
    description:
      "What `normalize_fields` would change, without changing it: one entry per contact that has work to do, each listing the fields, the old and new values and the rules responsible. Records already conforming are omitted, so an empty result means there is nothing to do. Changes nothing.",
    parameters: [
      { name: "ids", type: "string[]", required: true, maxItems: MAX_IDS, description: "Contact ids" },
      { name: "rules", type: "string[]", required: true, enum: [...RULES], maxItems: RULES.length, description: "Rules to apply" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ ids, rules }) => previewNormalizeAction(asIds(ids), asRules(rules)),
  });

  useWebMCPTool({
    name: "flag_stale",
    description: "Mark contacts as stale so a human revisits them before the next campaign.",
    parameters: [
      { name: "ids", type: "string[]", required: true, maxItems: MAX_IDS, description: "Contact ids" },
    ],
    reversible: true,
    sideEffects: "data",
    handler: async ({ ids }) => {
      const result = await flagStaleAction(asIds(ids));
      toast(result.error ?? result.summary, result.ok ? "success" : "error");
      return result.error ?? result.summary;
    },
  });

  useWebMCPTool({
    name: "merge_contacts",
    description:
      "Fold one contact into another. The dropped record stays visible in the merged segment, but the two histories become one.",
    parameters: [
      { name: "keep_id", type: "string", required: true, description: "Contact that survives" },
      { name: "drop_id", type: "string", required: true, description: "Contact folded in" },
    ],
    reversible: false,
    sideEffects: "data",
    handler: async ({ keep_id, drop_id }) => {
      const result = await mergeAction(String(keep_id), String(drop_id));
      toast(result.error ?? result.summary, result.ok ? "success" : "error");
      return result.error ?? result.summary;
    },
  });

  useWebMCPTool({
    name: "delete_contacts",
    description: "Permanently remove contacts from every segment.",
    parameters: [
      { name: "ids", type: "string[]", required: true, maxItems: MAX_IDS, description: "Contact ids" },
    ],
    reversible: false,
    sideEffects: "data",
    handler: async ({ ids }) => {
      const result = await deleteAction(asIds(ids));
      toast(result.error ?? result.summary, result.ok ? "success" : "error");
      return result.error ?? result.summary;
    },
  });

  /*
   * The read every other pair tool depends on. `preview_merge`, `resolve_pair` and
   * `merge_contacts` all address a record by id, and until this existed nothing here handed one
   * out — `read_state` returns counts — so an agent asked to merge the worst duplicate could only
   * refuse or invent an id, and the two GATED tools on this surface were unreachable from a
   * conversation. Bounded and announced, like every other read (AGENTS.md).
   */
  useWebMCPTool({
    name: "read_pairs",
    description:
      "The open merge queue, most confident first: pair id, the two contact ids, the confidence and the matching evidence. Bounded; the footer says how many there are. Changes nothing.",
    parameters: [
      {
        name: "limit",
        type: "number",
        required: false,
        description: "How many pairs to return; defaults to 10, capped at 50",
      },
    ],
    reversible: true,
    sideEffects: "none",
    handler: async ({ limit }) => listPairsAction(Number(limit) || 0),
  });

  useWebMCPTool({
    name: "preview_merge",
    description:
      "Return the side-by-side fields, the confidence and the matching rules for one candidate pair. Changes nothing.",
    parameters: [
      { name: "pair_id", type: "string", required: true, description: "Candidate pair id, e.g. pair_007" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: async ({ pair_id }) => {
      const preview = await previewMergeAction(String(pair_id));
      return preview ?? `No pair ${String(pair_id)}.`;
    },
  });

  /*
   * The other two answers to a candidate pair. Without this the queue had one closing verb and it
   * was the irreversible one, so an agent that judged the evidence insufficient could only leave
   * the pair open or propose the merge anyway.
   */
  useWebMCPTool({
    name: "resolve_pair",
    description:
      "Close a candidate pair without merging: `kept_both` when the two records are genuinely different people, `skipped` when the evidence is not enough to decide. Reversible - the verdict is one row in the activity log and `undo` reopens the pair.",
    parameters: [
      { name: "pair_id", type: "string", required: true, description: "Candidate pair id, e.g. pair_007" },
      { name: "verdict", type: "string", enum: [...VERDICTS], required: true, description: "How the pair is being closed" },
    ],
    reversible: true,
    sideEffects: "data",
    handler: async ({ pair_id, verdict }) => {
      const which = asVerdict(verdict);
      if (!which) return `Unknown verdict ${String(verdict)}.`;
      const result = await resolvePairAction(String(pair_id), which);
      toast(result.error ?? result.summary, result.ok ? "success" : "error");
      return result.error ?? result.summary;
    },
  });

  /*
   * The company-name conflict: the three tools it takes, in the order they are used.
   *
   * `read_conflicts` says which domains are spelled more than one way and how; `preview_company`
   * says what settling one of them would rewrite; `resolve_company` writes it. The shape is
   * deliberately `preview_normalize` / `normalize_fields` again, because the write is the same
   * write - a revision row per contact, replayable backwards - and a surface that gave a second
   * reversible field rewrite a different shape would be teaching the agent that this one is
   * different. It is not. What is different is where the DECISION comes from: which spelling is
   * the company's real name is not in the data, and in this demo Athena knows it from another app.
   */
  useWebMCPTool({
    name: "read_conflicts",
    description:
      "Domains whose contacts spell one company more than one way: every spelling, how many contacts carry it, and which spelling the most contacts carry. Pass a domain to read just that one, in conflict or not. Bounded; the footer says how many there are. Changes nothing.",
    parameters: [
      { name: "domain", type: "string", required: false, description: "One email domain, e.g. pinegrove-collective.example; omit for every conflicted domain" },
      { name: "limit", type: "number", required: false, description: `How many domains to return; capped at ${MAX_DOMAINS}` },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ domain, limit }) =>
      readConflictsAction(
        domain === undefined || String(domain).trim() === "" ? undefined : String(domain).trim().toLowerCase(),
        Number(limit) || 0,
      ),
  });

  useWebMCPTool({
    name: "preview_company",
    description:
      "What `resolve_company` would rewrite on one domain: the spellings it carries now, how many contacts would change, and a bounded sample of the changes with each contact's current company. Changes nothing.",
    parameters: [
      { name: "domain", type: "string", required: true, description: "Email domain to settle" },
      { name: "canonical_name", type: "string", required: true, description: "The spelling to keep" },
    ],
    reversible: true,
    sideEffects: "none",
    handler: ({ domain, canonical_name }) =>
      previewCompanyAction(String(domain ?? ""), String(canonical_name ?? "")),
  });

  useWebMCPTool({
    name: "resolve_company",
    description:
      "File every contact on one email domain under one spelling of their company. Each rewrite is a revision row and the whole call is one activity entry, so `undo` puts every one of them back - the same path a normalisation takes.",
    parameters: [
      { name: "domain", type: "string", required: true, description: "Email domain to settle" },
      { name: "canonical_name", type: "string", required: true, description: "The spelling every contact on the domain should carry" },
    ],
    reversible: true,
    sideEffects: "data",
    handler: async ({ domain, canonical_name }) => {
      const result = await resolveCompanyAction(String(domain ?? ""), String(canonical_name ?? ""));
      toast(result.error ?? result.summary, result.ok ? "success" : "error");
      return result.error ?? result.summary;
    },
  });

  /*
   * The third step of `normalize, check, undo if wrong`, which `normalize_fields`' description has
   * always promised. GATED, and not by preference: `undoActivity` logs its own row
   * `reversible: false`, so by the design 5.1 rule this is an irreversible write however benign it
   * feels. An agent may still plan it — it just has to be answered for before it runs.
   */
  useWebMCPTool({
    name: "undo",
    description:
      "Put back one reversible write, by the activity-log id it was recorded under. Normalisations replay their revisions backwards, stale flags are cleared, a closed pair reopens. An entry that is not reversible, or that was already undone, is refused with the reason.",
    parameters: [
      { name: "activity_id", type: "number", required: true, description: "Activity log id of the write to reverse" },
    ],
    reversible: false,
    sideEffects: "data",
    handler: async ({ activity_id }) => {
      const id = Number(activity_id);
      if (!Number.isInteger(id)) return `Not an activity id: ${String(activity_id)}.`;
      const result = await undoAction(id);
      const message = result.ok ? `Undid #${id}.` : (result.reason ?? `Could not undo #${id}.`);
      toast(message, result.ok ? "success" : "error");
      return message;
    },
  });

  return null;
}
