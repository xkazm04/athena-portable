"use client";

/**
 * The tray - the tick, made into something a person can act on.
 *
 * It mounts whenever the tick is non-empty, whoever ticked: an agent's `select` or the person's
 * own Ctrl/Cmd-click (or `x`) on a mark. It counts the set from the sheet, offers the AUTO acts
 * over it with what the books would refuse stated before the press, opens the first ticked card,
 * and clears. Every rule it follows is in `tray-plan.ts`; this file only draws it.
 *
 * Send, record and void are not here on purpose: they stay one invoice at a time behind the
 * card's Gate (`tray-plan.ts` trayActs).
 */
import { useMemo, useRef, useState } from "react";

import { categorizeAction, draftReminderAction } from "@/app/actions";
import { CATEGORIES, TONES, type Category, type Tone } from "@/lib/constants";
import { formatMoneyShort } from "@/lib/format";
import type { LnSheet } from "../model";
import { useRun } from "../useRun";
import { createBatch, draftPlan, refilePlan, trayFor } from "./tray-plan";

export function Tray({
  sheet,
  picked,
  setPicked,
  onOpen,
}: {
  sheet: LnSheet;
  picked: readonly string[];
  setPicked: (ids: string[]) => void;
  /** Open one ticked invoice's card. */
  onOpen: (laneId: string, id: string) => void;
}) {
  const { pending, run } = useRun();
  /* One runner per mounted tray: its flag is the synchronous door a double press meets. */
  const batch = useRef(createBatch());
  const [category, setCategory] = useState<Category>("uncategorized");
  const [tone, setTone] = useState<Tone>("gentle");

  const tray = useMemo(() => trayFor(sheet, picked), [sheet, picked]);
  const draft = useMemo(() => draftPlan(tray, sheet), [tray, sheet]);
  const refile = useMemo(() => refilePlan(tray, category), [tray, category]);
  const heldCount = draft.held.reduce((n, g) => n + g.ids.length, 0);
  const first = tray.items[0];

  if (tray.count === 0) return null;

  const areas = tray.lanes.length;
  const say = `${tray.count} ticked - ${formatMoneyShort(tray.owedCents)} open across ${areas} ${
    areas === 1 ? "area" : "areas"
  }`;

  const draftAll = () =>
    run(async () => {
      const out = await batch.current(draft.eligible, (id) => draftReminderAction(id, tone), "Drafted");
      if (!out.ok) return { ok: false, message: out.summary };
      // What failed becomes the tick, so the next press is already aimed at what is left.
      if (out.next.length > 0) setPicked(out.next);
      return { ok: out.failed.length === 0, message: out.summary };
    });

  const refileAll = () => run(() => categorizeAction(refile, category));

  return (
    <section className="ln-tray" aria-label="Ticked invoices" aria-busy={pending}>
      <p className="ln-tray-say" aria-live="polite">
        {say}
      </p>

      <div className="ln-tray-act">
        <label className="ln-tray-field">
          <span>Refile to</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} disabled={pending}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ln-tray-btn" onClick={refileAll} disabled={pending || refile.length === 0}>
          {refile.length === 0 ? "All filed there" : `Refile ${refile.length}`}
        </button>
      </div>

      <div className="ln-tray-act">
        <label className="ln-tray-field">
          <span>Tone</span>
          <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} disabled={pending}>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ln-tray-btn"
          onClick={draftAll}
          disabled={pending || draft.eligible.length === 0}
          aria-describedby={heldCount > 0 ? "ln-tray-held" : undefined}
        >
          {draft.eligible.length === 0 ? "None to draft" : `Draft ${tone} reminders for ${draft.eligible.length}`}
        </button>
      </div>

      {heldCount > 0 ? (
        <ul className="ln-tray-held" id="ln-tray-held" aria-label={`${heldCount} held back from drafting`}>
          {draft.held.map((g) => (
            <li key={g.reason}>
              <b>{g.ids.length}</b> {g.reason.replace(/^Blocked: /, "")}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ln-tray-act">
        <button
          type="button"
          className="ln-tray-btn"
          onClick={() => first && onOpen(first.laneId, first.id)}
          disabled={!first}
        >
          Review the first
        </button>
        <button type="button" className="ln-tray-btn" data-kind="quiet" onClick={() => setPicked([])} disabled={pending}>
          Clear
        </button>
      </div>
    </section>
  );
}
