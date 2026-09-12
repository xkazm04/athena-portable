"use client";

/**
 * The reversible half: everything that writes an undo.
 *
 * `move_stage` is in here and `decide_stage` is not, and they are two tools
 * rather than one for exactly that reason. Moving somebody into screening or an
 * interview is ordinary pipeline work and reverses cleanly; an offer or a
 * rejection ends their process. The gated half is `dossier/Gate.tsx`, drawn as
 * a different kind of place rather than a differently coloured button.
 */
import { useState } from "react";

import { addNote, moveStage, proposeSlots, scoreAgainstRubric } from "@/app/actions";
import { nextMoveFor, STAGE_LABEL } from "@/lib/constants";
import type { BdCandidate } from "../model";
import { useRun } from "../useRun";

export function DossierActs({ candidate }: { candidate: BdCandidate }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");

  /**
   * The next stage a reversible move may set.
   *
   * Anything past it is a decision and lives behind the gate below. That is the
   * split the whole panel exists to make visible: `move_stage` reverses
   * cleanly, `decide_stage` ends somebody's application. The ladder is not
   * re-typed here - `nextMoveFor` is the same declaration `moveStage` enforces
   * against, so the button and the server cannot drift apart.
   */
  const nextMove = nextMoveFor(candidate.stage);

  return (
    <div className="bd-auto-panel">
      <span className="bd-class" data-class="AUTO">
        Auto — reversible. Each of these writes an undo.
      </span>
      <div className="bd-actions">
        <button
          type="button"
          className="bd-btn"
          disabled={pending}
          onClick={() => run(() => scoreAgainstRubric(candidate.id))}
        >
          {candidate.scored ? "Score again" : "Score against the rubric"}
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
        <label className="bd-note-field">
          <span className="bd-block-label">Note</span>
          <textarea
            className="bd-note-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={1}
            aria-label={`A note on ${candidate.name}`}
          />
        </label>
        <button
          type="button"
          className="bd-btn"
          disabled={pending || note.trim().length === 0}
          onClick={() => run(() => addNote(candidate.id, note), () => setNote(""))}
        >
          File it
        </button>
      </div>
    </div>
  );
}
