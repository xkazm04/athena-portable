/**
 * Choosing the engine — README section 3.1 and 3.5, ADR 0085 and 0087.
 *
 * One component for the two places an engine is chosen in the console: the first act (Mind, step
 * one) and the Mind depth's engine level. It is the Setup module's own facts drawn as cards: the
 * probe's remedy in plain words, the failure to start with its one retry, the restart notice that
 * asks to be done now, and Check again. A pure function of the Setup view-model.
 */
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import ProblemNote from "@/components/ProblemNote";
import StatusDot, { type Tone } from "@/components/StatusDot";
import { remedyFor } from "@/lib/engines";
import type { SetupModel } from "@/modules/setup/model";
import { STANDING_TONE, engineFact, restartNotice } from "@/modules/setup/readiness";

import "./engine.css";

const BADGE: Record<string, string> = {
  found: "found",
  not_logged_in: "not signed in",
  not_found: "not found",
};

/** The hue rides the badge's dot, not its words (house style 4b). */
const BADGE_TONE: Record<string, Tone> = {
  found: "success",
  not_logged_in: "warning",
  not_found: "warning",
};

/**
 * What an engine with no probe says. A check in flight (or not yet asked) is "checking"; a check
 * that could not run, or a daemon that did not start to run it, is a settled fact and says so,
 * with its remedy, so a failure never reads as a wait that will end by itself.
 */
function unprobed(model: SetupModel): { word: string; tone: Tone; line: string } {
  if (!model.checking && model.probes === null && model.startFailure) {
    return { word: "not checked", tone: "warning", line: "Nothing is known of this engine until Athena starts." };
  }
  if (!model.checking && model.probes === null && model.problem) {
    return {
      word: "not checked",
      tone: "warning",
      line: "The check did not go through, so nothing is known of this engine yet. Press Check again.",
    };
  }
  return { word: "checking", tone: "pending", line: "Athena has not heard back about this engine yet." };
}

/**
 * The restart that asks to be done now, drawn once for every place that shows it (this section and
 * the Mind field), so its spacing and its fade-in cannot drift apart. Nothing when none is pending.
 */
export function RestartNoticeBar({ model }: { model: SetupModel }) {
  const notice = restartNotice(model);
  if (!notice) return null;
  return (
    <div className="engines__notice" role="status">
      <p>
        <b>{notice.title}</b> {notice.detail}
      </p>
      <Button variant="primary" size="sm" onClick={model.actions.restart}>
        {notice.actionLabel}
      </Button>
    </div>
  );
}

export default function EngineSection({ model }: { model: SetupModel }) {
  const fact = engineFact(model);
  const none = unprobed(model);
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
      <RestartNoticeBar model={model} />
      <ul className="engines__list">
        {model.engines.map((e) => {
          const chosen = model.engine === e.id;
          const state = e.probe?.state ?? "unknown";
          return (
            <li key={e.id} className="engines__card" data-chosen={chosen} data-state={state}>
              <div className="engines__head">
                <h2>{e.label}</h2>
                <Badge tone={BADGE_TONE[state] ?? none.tone}>{BADGE[state] ?? none.word}</Badge>
              </div>
              <p className="engines__line">{e.probe ? remedyFor(e.probe) : none.line}</p>
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
          {model.checking ? "Checking…" : "Check again"}
        </Button>
        <span className="engines__fact" data-standing={fact.standing}>
          <StatusDot tone={STANDING_TONE[fact.standing]} />
          {fact.summary}
        </span>
      </div>
    </div>
  );
}
