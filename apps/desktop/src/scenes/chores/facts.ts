/** The topic page's facts — README section 3.5, ADR 0096: the few figures the catalogue and the topic page both read, from the playbook alone. */
import type { StoryStill } from "@/lib/playbooks";
import type { JobId } from "@/lib/playbook-taxonomy";
import { withReviewMinutes, type PlaybookView } from "@/modules/playbooks/model";

/** The bundled stills of the run, in order; a still this build does not carry is left out. */
export function stillsOf(view: PlaybookView): StoryStill[] {
  return (view.playbook.evidence?.story ?? []).filter((s) => s.url);
}

/** "6h", "45m", "40s": a duration kept to a few characters for a ledger cell. */
export function compact(min: number): string {
  if (min <= 0) return "–";
  if (min < 1) return `${Math.max(1, Math.round(min * 60))}s`;
  if (min < 90) return `${Math.round(min)}m`;
  const h = min / 60;
  return `${h >= 10 || h % 1 === 0 ? Math.round(h) : h.toFixed(1)}h`;
}

/** By hand against with Athena (her run plus your review), in a cell: "6h → 9m", or no Athena figure when nothing is measured. */
export function timeCell(view: PlaybookView): { hand: string; athena: string | null } {
  const p = view.playbook;
  return {
    hand: compact(p.economics.manualMinutes),
    athena: p.bench ? compact(withReviewMinutes(p.bench)) : null,
  };
}

/** A job's hue, as a token, so the pill reads the same in both themes. */
export const JOB_TONE: Record<JobId, string> = {
  recover: "var(--status-success)",
  claim: "var(--status-info)",
  contest: "var(--status-warning)",
  comply: "var(--role-agent)",
};

/** Lowercase significant words, for matching a gate to the step it guards. */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4)
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

/**
 * Where each gate sits on the spine: before the step that shares the most words with it, or `-1`
 * (just before the result) when no step names what it guards. A gate is the playbook's; only its
 * place on the drawing is inferred.
 */
export function gateSlots(steps: readonly string[], gates: readonly { label: string; action: string }[]): number[] {
  const stepWords = steps.map(words);
  return gates.map((g) => {
    const gw = words(`${g.label} ${g.action.replace(/_/g, " ")}`);
    let best = -1;
    let score = 0;
    stepWords.forEach((sw, i) => {
      let n = 0;
      for (const w of gw) if (sw.has(w)) n += 1;
      if (n > score) {
        score = n;
        best = i;
      }
    });
    return best;
  });
}
