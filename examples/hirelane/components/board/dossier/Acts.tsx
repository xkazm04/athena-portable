"use client";

/**
 * The reversible half of the action bar: everything that writes an undo.
 *
 * `move_stage` is in here and `decide_stage` is not, and they are two tools
 * rather than one for exactly that reason. Moving somebody into screening or an
 * interview is ordinary pipeline work and reverses cleanly; an offer or a
 * rejection ends their process. The gated half is `dossier/Gate.tsx`, and the
 * two are ZONES of one bar now rather than two stacked panels — see
 * `design/ui-pass-brief.md` §3 for the measurement that motivated the merge and
 * `style/level2/l2-dossier-2.css` for what carries the class once they share a
 * row.
 *
 * THE NOTE IS A DISCLOSURE, and that is the single biggest thing this file
 * gives back. It used to be a permanently mounted 469x62 textarea sitting in
 * the panel at all times — the least-used control in the dossier and the
 * largest. It is a button until somebody wants it, and then it takes the row it
 * needs and gives it straight back.
 */
import { useState } from "react";

import { addNote, moveStage, proposeSlots, scoreAgainstRubric } from "@/app/actions";
import { nextMoveFor, STAGE_LABEL } from "@/lib/constants";
import type { BdCandidate } from "../model";
import { useRun } from "../useRun";

export function DossierActs({ candidate }: { candidate: BdCandidate }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);

  /**
   * The next stage a reversible move may set.
   *
   * Anything past it is a decision and lives behind the gate beside it. That is
   * the split the whole bar exists to make visible: `move_stage` reverses
   * cleanly, `decide_stage` ends somebody's application. The ladder is not
   * re-typed here - `nextMoveFor` is the same declaration `moveStage` enforces
   * against, so the button and the server cannot drift apart.
   */
  const nextMove = nextMoveFor(candidate.stage);

  const close = () => {
    setNoting(false);
    setNote("");
  };

  return (
    <div className="bd-zone" data-class="AUTO">
      <span className="bd-class" data-class="AUTO">
        Auto — reversible. Each of these writes an undo.
      </span>

      {noting ? (
        <div className="bd-actions">
          <label className="bd-note-field">
            <span className="bd-block-label">Note</span>
            <input
              className="bd-note-input"
              value={note}
              autoFocus
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") close();
              }}
              aria-label={`A note on ${candidate.name}`}
            />
          </label>
          <button
            type="button"
            className="bd-btn"
            disabled={pending || note.trim().length === 0}
            onClick={() => run(() => addNote(candidate.id, note), close)}
          >
            File it
          </button>
          <button type="button" className="bd-btn" onClick={close}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="bd-actions">
          <button
            type="button"
            className="bd-btn"
            disabled={pending}
            onClick={() => run(() => scoreAgainstRubric(candidate.id))}
          >
            {/* "Score against the rubric" named the tool where the tool is already named: the
                capability register in the foot carries `score_against_rubric` in full, and this
                dossier is nothing but the rubric. The pair reads as a state now - Score, then
                Score again - which is the thing the button actually reports. */}
            {candidate.scored ? "Score again" : "Score"}
          </button>
          {nextMove ? (
            <button
              type="button"
              className="bd-btn"
              disabled={pending}
              onClick={() => run(() => moveStage(candidate.id, nextMove))}
            >
              Move to {STAGE_LABEL[nextMove]}
            </button>
          ) : null}
          <button
            type="button"
            className="bd-btn"
            disabled={pending}
            onClick={() => run(() => proposeSlots(candidate.id))}
          >
            Propose slots
          </button>
          <button type="button" className="bd-btn" onClick={() => setNoting(true)}>
            Note…
          </button>
        </div>
      )}
    </div>
  );
}
