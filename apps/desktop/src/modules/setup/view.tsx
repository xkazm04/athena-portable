/**
 * The Setup module's surface — a pure function of `SetupModel`, in two moods.
 *
 * **Onboarding** is a short letter in one column: what Athena is, in three sentences, then the
 * two things the first turn needs — an engine that answered, a page to work beside — and one
 * button. The microphone is one optional line under them. Nothing is numbered, because these are
 * not a sequence: a person who cannot install an engine can still open a page.
 *
 * **Settings** is the same facts as a list a returning person adjusts: one row per fact, a
 * hairline between rows, the fact in a sentence on the left and its control on the right. No
 * cards per item — eleven words of engine and three of theme do not each need a fold.
 *
 * Neither mood claims anything the machine has not said. Readiness is derived at render; a
 * restart is offered only when a running daemon disagrees with the stored row; a probe's words
 * are printed as the probe's words.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import Button from "@/components/Button";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import StatusDot, { type Tone } from "@/components/StatusDot";
import { TextInput } from "@/components/FormField";
import { engineLabel, probeOf, remedyFor, usable } from "@/lib/engines";
import { normaliseUrl } from "@/lib/url";
import { THEME_CHOICES, type ThemeChoice } from "@/stores/settings";

import type { SetupModel } from "./model";
import {
  STANDING_TONE,
  WHAT_ATHENA_IS,
  brainFact,
  engineFact,
  engineLead,
  isReady,
  micFact,
  notReadyBecause,
  pageFact,
  restartNotice,
  voiceFact,
} from "./readiness";

import "./setup.css";

const THEME_HINTS: Record<ThemeChoice, string> = {
  system: "Follow the operating system, and switch when it does.",
  light: "Always light.",
  dark: "Always dark.",
};

export default function SetupView({ model }: { model: SetupModel }) {
  return model.mode === "onboarding" ? <Onboarding model={model} /> : <Settings model={model} />;
}

// -- onboarding: the letter --------------------------------------------------------------------

function Onboarding({ model }: { model: SetupModel }) {
  const ready = isReady(model);
  const because = notReadyBecause(model);
  return (
    <PageShell>
      <div className="setup-letter">
        <header className="setup-letter__head">
          <h1 className="typo-heading-lg">Athena is on this machine.</h1>
          <p className="typo-body">
            She works inside the apps you already have open, and asks before anything that cannot
            be undone.
          </p>
        </header>

        <ul className="setup-claims">
          {WHAT_ATHENA_IS.map((claim) => (
            <li key={claim.title} className="typo-body">
              <span className="typo-title">{claim.title}.</span> {claim.body}
            </li>
          ))}
        </ul>

        <Passage title="Choose the engine" fact={engineFact(model).summary}>
          <EngineChoice model={model} />
          <EngineDetail model={model} />
        </Passage>

        <Passage title="Open the first app" fact={pageFact(model).summary}>
          <OpenPage model={model} />
        </Passage>

        <Passage title="A microphone, if you want to talk" fact={micFact(model).summary} optional>
          <MicControl model={model} />
        </Passage>

        <div className="setup-letter__foot">
          <Button
            variant={ready ? "primary" : "secondary"}
            onClick={model.actions.finish}
            disabledReason={ready ? undefined : because}
          >
            Start using Athena
          </Button>
          <span className="typo-caption">
            {ready
              ? "Athena opens on the page you left open."
              : "Setup stays in the bar; nothing has to be finished in one sitting."}
          </span>
          {!ready ? (
            <Button variant="ghost" size="sm" onClick={model.actions.finish}>
              Skip for now
            </Button>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

/** One thing the machine needs, with its standing beside the title. Not a step: a passage. */
function Passage({
  title,
  fact,
  optional = false,
  children,
}: {
  title: string;
  fact: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="setup-passage">
      <div className="setup-passage__head">
        <h2 className="typo-heading">{title}</h2>
        <span className="typo-caption">
          {optional ? "optional — " : ""}
          {fact}
        </span>
      </div>
      {children}
    </section>
  );
}

// -- settings: the list ----------------------------------------------------------------------

function Settings({ model }: { model: SetupModel }) {
  const notice = restartNotice(model);
  const engine = engineFact(model);
  const page = pageFact(model);
  const brain = brainFact(model);
  const mic = micFact(model);
  const voice = voiceFact(model);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Setup"
        title="How Athena is set up"
        caption="The engine, the page, the brain, the voice — and where it all lives."
        action={
          <Button variant="ghost" size="sm" onClick={model.actions.reopenOnboarding}>
            Show the welcome again
          </Button>
        }
      />

      {model.problem ? (
        <ProblemNote
          title="No engine probe has answered, so nothing is known about what is installed."
          reason={model.problem}
          detail="The daemon runs the probe; the names below are all this page can say on its own."
        />
      ) : null}

      <div className="setup-list">
        <Row label="Engine" tone={STANDING_TONE[engine.standing]} fact={engineSentence(model)}>
          <div className="setup-row__stack">
            <EngineChoice model={model} />
            {notice ? (
              <div className="setup-notice" role="status">
                <p className="typo-body">{notice.title}</p>
                <p className="typo-caption">{notice.detail}</p>
                <span className="row">
                  <Button variant="primary" size="sm" onClick={model.actions.restart}>
                    {notice.actionLabel}
                  </Button>
                </span>
              </div>
            ) : null}
            <EngineDetail model={model} compact />
          </div>
        </Row>

        <Row label="Page" tone={STANDING_TONE[page.standing]} fact={pageSentence(model)}>
          <OpenPage model={model} compact />
        </Row>

        <Row label="Theme" tone="neutral" fact={THEME_HINTS[model.theme]}>
          <PillGroup
            ariaLabel="Theme"
            value={model.theme}
            onChange={model.actions.setTheme}
            options={THEME_CHOICES.map((choice) => ({
              value: choice,
              label: choice,
              hint: THEME_HINTS[choice],
            }))}
          />
        </Row>

        <Row
          label="Brain"
          tone={STANDING_TONE[brain.standing]}
          fact={
            model.brainPath
              ? "Episodes, facts and playbooks are written here."
              : "Episodes go to the daemon's own directory."
          }
        >
          <BrainField model={model} />
        </Row>

        <Row label="Microphone" tone={STANDING_TONE[mic.standing]} fact={micSentence(model)}>
          <MicControl model={model} compact />
        </Row>

        <Row label="Voice" tone={STANDING_TONE[voice.standing]} fact={voiceSentence(model)}>
          <span className="typo-caption">{voice.summary}</span>
        </Row>

        <Row
          label="Data"
          tone="neutral"
          fact="One SQLite file: settings, origins, projects, activity and captures. Copy it to move this machine's Athena."
        >
          <code className="typo-code setup-path">
            {model.storePath ?? "the shell has not answered store_path yet"}
          </code>
        </Row>
      </div>
    </PageShell>
  );
}

/** One fact and its control. The hairline between rows is the only structure the list has. */
function Row({
  label,
  tone,
  fact,
  children,
}: {
  label: string;
  tone: Tone;
  fact: string;
  children: ReactNode;
}) {
  return (
    <div className="setup-row">
      <div className="setup-row__fact">
        <span className="row row--baseline">
          <StatusDot tone={tone} />
          <span className="typo-title">{label}</span>
        </span>
        <p className="typo-caption">{fact}</p>
      </div>
      <div className="setup-row__control">{children}</div>
    </div>
  );
}

// -- the sentences -------------------------------------------------------------------------------

function engineSentence(model: SetupModel): string {
  if (model.probes === null) {
    return model.problem
      ? "The engine probe could not be read."
      : `${engineLabel(model.engine)} is stored; the probe has not answered yet.`;
  }
  const chosen = probeOf(model.probes, model.engine);
  if (chosen?.state === "found") {
    return `${engineLabel(model.engine)} runs the turns${
      model.daemonHealth === "ready" && model.daemonEngine === model.engine ? ", and is running now" : ""
    }.`;
  }
  return `${engineLabel(model.engine)} is chosen and cannot run a turn yet.`;
}

function pageSentence(model: SetupModel): string {
  if (model.tabs.length === 0) return "No page is open. Athena works inside one.";
  if (model.tabs.length === 1) return `One page is open, on ${model.tabs[0].host}.`;
  return `${model.tabs.length} pages are open.`;
}

function micSentence(model: SetupModel): string {
  switch (model.mic) {
    case "granted":
      return "The microphone answered. Hold the key in the bar, or Ctrl+Space, to talk.";
    case "denied":
      return "The webview refused the microphone; push-to-talk stays off until it is allowed.";
    case "unsupported":
      return "No microphone was found; every turn can still be typed.";
    default:
      return "Not asked yet. Asking here keeps the prompt out of a turn.";
  }
}

function voiceSentence(model: SetupModel): string {
  if (model.voiceAvailable) return "The daemon can hear and speak.";
  if (model.daemonHealth !== "ready") return "The daemon is not running, so nothing is known yet.";
  return "The daemon was started without a voice backend.";
}

// -- the controls ----------------------------------------------------------------------------------

function EngineChoice({ model }: { model: SetupModel }) {
  return (
    <PillGroup
      ariaLabel="Engine"
      value={model.engine}
      onChange={model.actions.chooseEngine}
      disabled={!model.hydrated}
      options={model.engines.map((e) => ({
        value: e.id,
        label: e.label,
        hint: e.probe?.detail,
        // A signed-out engine is still choosable: the row is a preference, and the remedy belongs
        // beside it rather than in place of it.
        ...(e.probe?.state === "not_found" ? { disabledReason: e.disabledReason } : {}),
      }))}
    />
  );
}

/** What the probe said, verbatim, and the one thing to do about it. */
function EngineDetail({ model, compact = false }: { model: SetupModel; compact?: boolean }) {
  const { probes } = model;
  if (probes === null) {
    return compact ? null : (
      <p className="typo-caption">
        {model.problem
          ? `The engine probe could not be read: ${model.problem}`
          : "Found will mean the binary answered its version flag — not that it is signed in."}
      </p>
    );
  }
  const chosen = probeOf(probes, model.engine);
  const shown = compact ? probes.filter((p) => p.state !== "found" || p.id === model.engine) : probes;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {compact ? null : <p className="typo-caption">{engineLead(usable(probes).length, probes.length)}</p>}
      {shown.map((probe) => (
        <div key={probe.id} className="setup-probe">
          <span className="row row--baseline">
            <StatusDot
              tone={
                probe.state === "found"
                  ? "success"
                  : probe.state === "not_logged_in"
                    ? "warning"
                    : "neutral"
              }
            />
            <span className="typo-data">{engineLabel(probe.id)}</span>
            <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
              {probe.detail}
            </span>
          </span>
          {probe.state !== "found" ? <span className="typo-caption">{remedyFor(probe)}</span> : null}
        </div>
      ))}
      {chosen && chosen.state !== "found" && !compact ? (
        <p className="typo-caption">{engineLabel(chosen.id)} is chosen and cannot run a turn yet.</p>
      ) : null}
    </div>
  );
}

function OpenPage({ model, compact = false }: { model: SetupModel; compact?: boolean }) {
  const [typed, setTyped] = useState("");
  const open = (raw: string) => {
    const url = normaliseUrl(raw);
    if (!url) return;
    model.actions.openPage(url);
    setTyped("");
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="row">
        <TextInput
          value={typed}
          placeholder={compact ? "Open another" : "invoicing.example.test"}
          aria-label="Address of an app to open"
          style={{ flex: "1 1 14rem" }}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open(typed);
          }}
        />
        <Button
          variant={compact ? "secondary" : "primary"}
          size="sm"
          disabledReason={typed.trim() ? undefined : "Type an address first."}
          onClick={() => open(typed)}
        >
          Open
        </Button>
      </span>
      {model.tabs.length ? (
        <ul className="setup-tabs">
          {model.tabs.map((tab) => (
            <li key={tab.id} className="row row--baseline">
              <StatusDot tone="success" />
              <span className="typo-body truncate" style={{ maxWidth: "22rem" }}>
                {tab.title}
              </span>
              <span className="typo-caption">{tab.host}</span>
            </li>
          ))}
        </ul>
      ) : compact ? null : (
        <p className="typo-caption">
          Any site. A page that registers nothing simply offers no tools, and the generic hands
          still reach it.
        </p>
      )}
    </div>
  );
}

function MicControl({ model, compact = false }: { model: SetupModel; compact?: boolean }) {
  return (
    <span className="row">
      <Button
        size="sm"
        variant={model.mic === "granted" ? "secondary" : compact ? "secondary" : "primary"}
        onClick={model.actions.checkMic}
      >
        {model.mic === "unknown" ? "Check the microphone" : "Check again"}
      </Button>
      {model.micDetail ? (
        <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
          {model.micDetail}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A path, committed on Enter or the button. The field is a draft until it is committed, so a
 * half-typed directory is never written: the store is read by the daemon at start-up, and a path
 * that exists for three keystrokes is a path Athena would have tried to use.
 */
function BrainField({ model }: { model: SetupModel }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? model.brainPath;
  const dirty = draft !== null && draft !== model.brainPath;
  return (
    <span className="row">
      <TextInput
        value={value}
        placeholder="the daemon's default"
        aria-label="Brain directory"
        style={{ flex: "1 1 16rem" }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") model.actions.setBrainPath(value.trim());
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <Button
        size="sm"
        variant={dirty ? "primary" : "secondary"}
        disabledReason={dirty ? undefined : "Nothing has been typed that is not stored."}
        onClick={() => model.actions.setBrainPath(value.trim())}
      >
        Use this
      </Button>
    </span>
  );
}
