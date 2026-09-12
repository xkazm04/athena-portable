"use client";

/** Ticked cards gather in a floating dock where they can be filed together. */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CATEGORIES, type Category } from "@/lib/constants";
import { categorizeAction } from "@/app/actions";
import type { InvoiceRow } from "@/lib/types";
import { Money } from "./Money";
import { useRun } from "./useRun";
import { settle } from "./motion";

export function Dock({ rows, selection, onClear }: { rows: InvoiceRow[]; selection: string[]; onClear: () => void }) {
  const [category, setCategory] = useState<Category>("design");
  const { pending, run } = useRun();
  const cents = rows.filter((r) => selection.includes(r.id)).reduce((s, r) => s + r.balance_cents, 0);

  return (
    <AnimatePresence>
      {selection.length > 0 ? (
        <motion.div className="ed-dock" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={settle}>
          <div role="region" aria-label="Ticked invoices">
            <span>
              <b className="num">{selection.length}</b> ticked, <Money cents={cents} tone="owed" short />
            </span>
            <select className="ed-select" value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="File under">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className="ed-btn" data-kind="primary" data-size="sm" disabled={pending} onClick={() => run(() => categorizeAction(selection, category), onClear)}>
              {pending ? "Filing…" : "File them"}
            </button>
            <button type="button" className="ed-btn" data-kind="ghost" data-size="sm" onClick={onClear}>Clear</button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
