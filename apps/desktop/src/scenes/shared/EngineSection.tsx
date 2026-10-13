/**
 * Choosing the engine — README section 3.1 and 3.5, ADR 0085 and 0087.
 *
 * One component for the two places an engine is chosen in the console: the first act (Mind, step
 * one) and the Mind depth's engine level. It is the Setup module's own facts drawn as cards: the
 * probe's remedy in plain words, the failure to start with its one retry, the restart notice that
 * asks to be done now, and Check again. A pure function of the Setup view-model.
 */
import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import { remedyFor } from "@/lib/engines";
import type { SetupModel } from "@/modules/setup/model";
import { engineFact, restartNotice } from "@/modules/setup/readiness";

import "./engine.css";

const BADGE: Record<string, string> = {
  found: "found",
  not_logged_in: "not signed in",
  not_found: "not found",
};

export default function EngineSection({ model }: { model: SetupModel }) {
  const fact = engineFact(model);
  const notice = restartNotice(model);
  return (
    <div className="engines">
      {model.startFailure && (
        <ProblemNote
          title={model.startFailure.title}
          reason={model.startFailure.reason}
          tone="error"
          onRetry={model.actions.restart}
          retryLabel={model.startFailure.actionLabel}
        />
      )}
      {notice && (
        <div className="engines__notice" role="status">
          <p>
            <b>{notice.title}</b> {notice.detail}
          </p>
          <Button variant="primary" size="sm" onClick={model.actions.restart}>
            {notice.actionLabel}
          </Button>
        </div>
      )}
      <ul className="engines__list">
        {model.engines.map((e) => {
          const chosen = model.engine === e.id;
          const state = e.probe?.state ?? "unknown";
          return (
            <li key={e.id} className="engines__card" data-chosen={chosen} data-state={state}>
              <div className="engines__head">
                <h2>{e.label}</h2>
                <span className="engines__badge" data-state={state}>
                  {BADGE[state] ?? "checking"}
                </span>
              </div>
              <p className="engines__line">
                {e.probe ? remedyFor(e.probe) : "Athena has not heard back about this engine yet."}
              </p>
              {e.probe?.detail && state === "found" && <p className="engines__mono">{e.probe.detail}</p>}
              <Button
                variant={chosen ? "primary" : "secondary"}
                size="sm"
                disabledReason={e.disabledReason}
                onClick={() => model.actions.chooseEngine(e.id)}
                aria-pressed={chosen}
              >
                {chosen ? "Chosen" : `Use ${e.label}`}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="engines__row">
        <Button size="sm" onClick={model.actions.checkEngines} disabled={model.checking}>
          {model.checking ? "Checking..." : "Check again"}
        </Button>
        <span className="engines__fact" data-standing={fact.standing}>
          {fact.summary}
        </span>
      </div>
    </div>
  );
}
