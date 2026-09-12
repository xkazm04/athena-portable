"use client";

/**
 * Coins offered below, coins applied above. Settling one moves it physically between the trays
 * (`layoutId`), optimistically, and back again if the server refuses.
 */
import { useOptimistic } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { formatDate } from "@/lib/format";
import { isAmbiguous } from "@/lib/match";
import { matchAction, unmatchAction } from "@/app/actions";
import type { BankLine, Match, MatchCandidate } from "@/lib/types";
import { Money } from "./Money";
import { useRun } from "./useRun";
import { settle } from "./motion";

type Applied = Match & { line: BankLine };
type Lists = { matches: Applied[]; candidates: MatchCandidate[] };
type Move = { kind: "apply"; c: MatchCandidate } | { kind: "unapply"; id: string };

function reduce(s: Lists, m: Move): Lists {
  if (m.kind === "apply") {
    return {
      matches: [...s.matches, { invoice_id: "", line_id: m.c.line.id, matched_at: "", actor: "user", evidence: m.c.evidence.join("; "), line: m.c.line }],
      candidates: s.candidates.filter((c) => c.line.id !== m.c.line.id),
    };
  }
  return { ...s, matches: s.matches.filter((x) => x.line_id !== m.id) };
}

export function Settle({ invoiceId, matches, candidates, settled }: { invoiceId: string; matches: Applied[]; candidates: MatchCandidate[]; settled: boolean }) {
  const { pending, run } = useRun();
  const [lists, move] = useOptimistic({ matches, candidates }, reduce);
  const ambiguous = isAmbiguous(lists.candidates);

  return (
    <LayoutGroup id={`settle-${invoiceId}`}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="ed-tray" data-kind="applied">
          <span className="ed-tray-label">APPLIED</span>
          <AnimatePresence initial={false}>
            {lists.matches.length === 0 ? <motion.span key="none" className="ed-mute" style={{ fontSize: 13 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Nothing applied yet. Drop a coin here by settling it.</motion.span> : null}
            {lists.matches.map((m) => (
              <motion.div key={m.line_id} layoutId={m.line_id} className="ed-scoin" data-applied="true" transition={settle}>
                <b>{m.line.memo}</b>
                <Money cents={m.line.amount_cents} tone="ok" />
                <button type="button" className="ed-btn" data-kind="ghost" data-size="sm" disabled={pending} onClick={() => run(async () => { move({ kind: "unapply", id: m.line_id }); return unmatchAction(invoiceId, m.line_id); })}>
                  Lift off
                </button>
                <small>{formatDate(m.line.posted_at)}, {m.evidence}</small>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="ed-tray">
          <span className="ed-tray-label">ON THE STATEMENT</span>
          {ambiguous ? <span style={{ color: "var(--e-late)", fontSize: 13, fontWeight: 700 }}>Two coins fit almost equally. Check the statement first.</span> : null}
          <AnimatePresence initial={false}>
            {lists.candidates.length === 0 ? (
              <motion.span key="none" className="ed-mute" style={{ fontSize: 13 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {settled ? "Settled. No coin is waiting." : "No credit on the statement looks like this invoice."}
              </motion.span>
            ) : null}
            {lists.candidates.map((c) => (
              <motion.div key={c.line.id} layoutId={c.line.id} className="ed-scoin" transition={settle}>
                <b>{c.line.memo}</b>
                <Money cents={c.line.amount_cents} tone="owed" />
                {/* The affirmative tint never appears on a case the panel is simultaneously warning about. */}
                <button type="button" className="ed-btn" data-kind={c.confidence === "strong" && !ambiguous ? "ok" : undefined} data-size="sm" disabled={pending} onClick={() => run(async () => { move({ kind: "apply", c }); return matchAction(invoiceId, c.line.id); })}>
                  Settle
                </button>
                <small><em>{c.confidence}</em>{formatDate(c.line.posted_at)}, {c.evidence.join(", ")}</small>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </LayoutGroup>
  );
}
