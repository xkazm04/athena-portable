/**
 * The Settings module's surface — a pure function of `SettingsModel`.
 *
 * The object this page is about is a *command*: `athena serve --engine …`. Everything on it is
 * either an input to that line or a fact about the machine the line runs on, and it is laid out
 * as two columns because eleven words of engine and three of theme do not each need a fold
 * (house style §3.2 — a status card costs 90px to say four words).
 *
 * Three things it will not do:
 *
 * - **It does not claim the daemon restarted.** Choosing an engine writes a row and raises an
 *   intent; the notice says exactly what has and has not happened, including that nothing is
 *   listening yet. A page that said "engine changed" would be the surface lying.
 * - **It does not hide an engine it cannot use.** A missing or signed-out engine is offered with
 *   its remediation on it, because "codex is not installed" is a fact and "this app has one
 *   engine" is not.
 * - **It does not paraphrase a reason.** The probe's own words are printed as the probe's words.
 */
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import StatusDot, { type Tone } from "@/components/StatusDot";
import { engineLabel, remedyFor, type EngineState } from "@/lib/engines";
import { THEME_CHOICES, type ThemeChoice } from "@/stores/settings";

import { restartNotice, type EngineOption, type SettingsModel } from "./model";

/** What a probe's answer looks like beside the word that says the same thing (house style §4). */
const PROBE_TONE: Record<EngineState, Tone> = {
  found: "success",
  not_logged_in: "warning",
  not_found: "neutral",
  unknown: "pending",
};

const PROBE_WORD: Record<EngineState, string> = {
  found: "found",
  not_logged_in: "signed out",
  not_found: "not found",
  unknown: "not probed",
};

const THEME_HINTS: Record<ThemeChoice, string> = {
  system: "Follow the operating system, and switch when it does.",
  light: "Always light.",
  dark: "Always dark.",
};

export default function SettingsView({ model }: { model: SettingsModel }) {
  const { actions } = model;
  const notice = restartNotice(model);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="What Athena is started with"
        caption="One engine, one theme, one file on this machine."
        meta={
          <>
            <Badge tone={model.hydrated ? "info" : "pending"}>
              {model.hydrated ? engineLabel(model.engine) : "reading"}
            </Badge>
            <Badge tone="neutral">{model.theme}</Badge>
          </>
        }
      />

      {model.problem ? (
        <ProblemNote
          title="No engine probe has answered, so nothing is known about what is installed."
          reason={model.problem}
          detail="The daemon runs the probe; the names below are all this page can say on its own."
        />
      ) : null}

      <div className="split">
        <SectionCard
          title="Engine"
          note="who runs the turn"
          action={
            model.hydrated ? null : <span className="typo-caption">reading the stored rows…</span>
          }
        >
          <PillGroup
            ariaLabel="Engine"
            value={model.engine}
            onChange={actions.chooseEngine}
            disabled={!model.hydrated}
            options={model.engines.map((e) => ({
              value: e.id,
              label: e.label,
              hint: e.probe?.detail,
              // A signed-out engine is still choosable: the row is a *preference*, and the
              // remediation belongs beside it rather than in place of it.
              ...(e.probe?.state === "not_found" ? { disabledReason: e.disabledReason } : {}),
            }))}
          />

          {notice ? (
            <div className="problem-note" role="status">
              <span className="problem-note__mark typo-heading" aria-hidden="true">
                ↻
              </span>
              <div className="problem-note__body">
                <p className="typo-body">{notice.title}</p>
                <p className="typo-caption">{notice.detail}</p>
                <span className="row">
                  {notice.actionLabel ? (
                    <Button variant="primary" size="sm" onClick={actions.restartDaemon}>
                      {notice.actionLabel}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabledReason="The sidecar is not wired yet — the next commit owns daemon_restart."
                    >
                      Restart the daemon
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={actions.dismissRestart}>
                    Leave it
                  </Button>
                </span>
              </div>
            </div>
          ) : null}

          <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {model.engines.map((engine) => (
              <EngineLine key={engine.id} engine={engine} />
            ))}
          </ul>
        </SectionCard>

        <div className="stack" style={{ gap: "var(--density-gap)" }}>
          <SectionCard title="Theme" note="applied to every module at once">
            <PillGroup
              ariaLabel="Theme"
              value={model.theme}
              onChange={actions.setTheme}
              options={THEME_CHOICES.map((choice) => ({
                value: choice,
                label: choice,
                hint: THEME_HINTS[choice],
              }))}
            />
            <p className="typo-caption">{THEME_HINTS[model.theme]}</p>
          </SectionCard>

          <SectionCard title="Where it is kept" note="read-only">
            <Facts>
              <Fact label="store" value="code">
                {model.storePath ?? "the shell has not answered store_path yet"}
              </Fact>
            </Facts>
            {/* Not an editable field, and not by omission: moving the store is a copy of one
                file, and a path box that silently pointed at a directory the app cannot write
                would be a worse answer than none. */}
            <p className="typo-caption">
              One SQLite file: settings, origins, projects, activity and captures. Copy it to move
              this machine&rsquo;s Athena somewhere else.
            </p>
          </SectionCard>
        </div>
      </div>
    </PageShell>
  );
}

/**
 * One engine, what the probe said about it, and the one thing to do about that. The remediation
 * is always present — "nothing to do" included — because a blank cell reads as a missing fact.
 */
function EngineLine({ engine }: { engine: EngineOption }) {
  const state: EngineState = engine.probe?.state ?? "unknown";
  return (
    <li className="stack" style={{ gap: 2 }}>
      <span className="row row--baseline">
        <StatusDot tone={PROBE_TONE[state]} />
        <span className="typo-title">{engine.label}</span>
        <span className="typo-label muted">{PROBE_WORD[state]}</span>
      </span>
      {engine.probe ? (
        <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
          {engine.probe.detail}
        </span>
      ) : null}
      <span className="typo-caption">
        {engine.probe
          ? remedyFor(engine.probe)
          : "The probe has not answered, so nothing is known about this engine."}
      </span>
    </li>
  );
}
