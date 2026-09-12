/**
 * The Setup wizard's surface — *a letter, not a stepper*.
 *
 * It is the first thing a person sees, it is this app's one chance to say what Athena is, and its
 * job is to end. None of that is served by four accordion cards with one open at a time. What
 * serves it is a page that reads like a short letter about **this machine**, whose sentences are
 * composed from the view-model: "Claude Code answered its version flag", "Episodes go to the
 * daemon's own directory", "One page is open, on invoicing.example.test". Every sentence is true
 * at render, and a sentence cannot truncate a fact the way a row can.
 *
 * Beside it, for the person who has read it before, the same four facts in short: a rail that
 * names each station, its standing and the figure. A returning reader reads the rail and leaves.
 *
 * The step is the passage whose left rule is lit, and the rail moves it. **Nothing is gated by
 * it** — no passage is hidden because an earlier one is unanswered, because the machine's
 * problems are not sequential and a person who cannot install an engine can still open a page.
 *
 * Setup ends by leaving into a page, so the closing button's emphasis is *earned*: it is quiet
 * until the machine is actually ready, and then it is the one thing on the page asking to be
 * pressed.
 */
import { useState } from "react";
import type { ReactNode } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import FormField, { TextInput } from "@/components/FormField";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import SectionCard from "@/components/SectionCard";
import StatusDot from "@/components/StatusDot";
import { engineLabel, probeOf, remedyFor, usable } from "@/lib/engines";
import { normaliseUrl } from "@/lib/url";

import type { SetupModel, StepKey } from "./model";
import {
  STANDING_TONE,
  WHAT_ATHENA_IS,
  engineLead,
  inPlace,
  isReady,
  stations,
  type Station,
} from "./readiness";

export default function SetupView({ model }: { model: SetupModel }) {
  const all = stations(model);
  const figure = inPlace(model);
  const ready = isReady(model);

  const go = (step: StepKey) => {
    model.actions.goTo(step);
    document
      .getElementById(`setup-${step}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Setup"
        title="Athena is on this machine"
        caption={model.onboarded ? "The machine as it stands now." : undefined}
        meta={
          <Badge tone={ready ? "success" : "neutral"}>
            {`${figure.done} of ${figure.required} in place`}
          </Badge>
        }
      />

      <div className="split split--letter">
        <article className="stack" style={{ gap: "var(--density-gap)" }}>
          {model.onboarded ? null : <Claims />}

          <Passage step="engine" index={1} title="Engine" current={model.step}>
            <EnginePassage model={model} />
          </Passage>
          <Passage step="brain" index={2} title="Brain" current={model.step}>
            <BrainPassage model={model} />
          </Passage>
          <Passage step="page" index={3} title="A page" current={model.step}>
            <PagePassage model={model} />
          </Passage>
          <Passage step="mic" index={4} title="Microphone" current={model.step}>
            <MicPassage model={model} />
          </Passage>
          <Passage step="done" index={5} title="Done" current={model.step}>
            <p className="passage__lead">
              {ready
                ? "That is everything the first turn needs."
                : "Setup stays in the bar; nothing here has to be finished in one sitting."}
            </p>
            <span className="row">
              <Button variant={ready ? "primary" : "secondary"} onClick={model.actions.finish}>
                {model.onboarded ? "Back to the browser" : "Leave setup"}
              </Button>
              <span className="typo-caption">Athena opens on the page you left open.</span>
            </span>
          </Passage>
        </article>

        <InShort stations={all} current={model.step} onGo={go} />
      </div>
    </PageShell>
  );
}

// -- the three claims --------------------------------------------------------------------------

/** First run only. One sentence each: an introduction is the one place prose is the product. */
function Claims() {
  return (
    <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }}>
      {WHAT_ATHENA_IS.map((claim) => (
        <li key={claim.title} className="typo-body">
          <span className="typo-title">{claim.title}.</span> {claim.body}
        </li>
      ))}
    </ul>
  );
}

// -- a passage ---------------------------------------------------------------------------------

function Passage({
  step,
  index,
  title,
  current,
  children,
}: {
  step: StepKey;
  index: number;
  title: string;
  current: StepKey;
  children: ReactNode;
}) {
  return (
    <section
      id={`setup-${step}`}
      className="passage"
      aria-current={step === current ? "step" : undefined}
    >
      <p className="passage__label typo-label">
        0{index} · {title}
      </p>
      {children}
    </section>
  );
}

// -- engine ------------------------------------------------------------------------------------

function EnginePassage({ model }: { model: SetupModel }) {
  const { probes } = model;

  if (probes === null) {
    return (
      <>
        <p className="passage__lead">
          {model.problem
            ? "The engine probe could not be read."
            : "The engine probe has not answered yet."}
        </p>
        {model.problem ? (
          <ProblemNote
            title="The daemon runs the probe, so nothing is known about what is installed here."
            reason={model.problem}
            detail="Athena still starts; the first turn is what will fail, and it will say so."
          />
        ) : (
          <p className="typo-caption">
            Found will mean the binary answered its version flag — not that it is signed in, and
            not that the model runs on this machine.
          </p>
        )}
        <EngineChoice model={model} />
      </>
    );
  }

  const found = usable(probes);
  const chosen = probeOf(probes, model.engine);

  return (
    <>
      <p className="passage__lead">{engineLead(found.length, probes.length)}</p>
      <EngineChoice model={model} />
      <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4 }}>
        {probes.map((probe) => (
          <li key={probe.id} className="stack" style={{ gap: 1 }}>
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
              <span className="typo-title">{engineLabel(probe.id)}</span>
              {/* The probe's own words, verbatim: a version string, or the reason it cannot be
                  used. Paraphrasing one is how a surface starts guessing. */}
              <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
                {probe.detail}
              </span>
            </span>
            <span className="typo-caption">{remedyFor(probe)}</span>
          </li>
        ))}
      </ul>
      {chosen && chosen.state !== "found" ? (
        <p className="typo-caption">
          {engineLabel(chosen.id)} is the chosen engine and it cannot run a turn yet.
        </p>
      ) : null}
    </>
  );
}

function EngineChoice({ model }: { model: SetupModel }) {
  return (
    <PillGroup
      ariaLabel="Engine"
      value={model.engine}
      onChange={model.actions.chooseEngine}
      options={model.engineIds.map((id) => ({
        value: id,
        label: engineLabel(id),
        hint: probeOf(model.probes, id)?.detail,
      }))}
    />
  );
}

// -- brain -------------------------------------------------------------------------------------

/**
 * A path, and the one sentence that says what an empty one means. The field is a draft until it
 * is committed, so a half-typed directory is never written: the store is read by the daemon at
 * start-up and a path that exists for three keystrokes is a path Athena would have tried to use.
 */
function BrainPassage({ model }: { model: SetupModel }) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? model.brainPath;
  const dirty = draft !== null && draft !== model.brainPath;

  return (
    <>
      <p className="passage__lead">
        {model.brainPath
          ? "Episodes, facts and playbooks are written here."
          : "Episodes go to the daemon's own directory."}
      </p>
      <FormField
        label="Brain directory"
        hint="Markdown on disk is the truth and the index is rebuilt from it, so this directory is portable by copying. Empty means the daemon's default."
      >
        {(input) => (
          <span className="row">
            <TextInput
              {...input}
              value={value}
              placeholder="the daemon's default"
              style={{ flex: "1 1 18rem" }}
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
        )}
      </FormField>
    </>
  );
}

// -- a page ------------------------------------------------------------------------------------

function PagePassage({ model }: { model: SetupModel }) {
  const [typed, setTyped] = useState("");
  const open = (raw: string) => {
    const url = normaliseUrl(raw);
    if (!url) return;
    model.actions.openPage(url);
    setTyped("");
  };

  return (
    <>
      <p className="passage__lead">
        {model.tabs.length === 0
          ? "Athena works beside a page you already use. Open the first one."
          : `${model.tabs.length === 1 ? "One page is" : `${model.tabs.length} pages are`} open.`}
      </p>
      <FormField
        label="Open your first app"
        hint="Any site. A page that registers nothing simply offers no tools, and the generic hands still reach it."
      >
        {(input) => (
          <span className="row">
            <TextInput
              {...input}
              value={typed}
              placeholder="invoicing.example.test"
              style={{ flex: "1 1 18rem" }}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") open(typed);
              }}
            />
            <Button
              variant="primary"
              size="sm"
              disabledReason={typed.trim() ? undefined : "Type an address first."}
              onClick={() => open(typed)}
            >
              Open
            </Button>
          </span>
        )}
      </FormField>
      {model.tabs.length === 0 ? (
        <EmptyState
          glyph="+"
          title="No page open"
          line="The address above opens one, and the Browser module keeps it."
        />
      ) : (
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 2 }}>
          {model.tabs.map((tab) => (
            <li key={tab.id} className="row row--baseline">
              <StatusDot tone="success" />
              <span className="typo-body truncate" style={{ maxWidth: "26rem" }}>
                {tab.title}
              </span>
              <span className="typo-caption">{tab.host}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// -- the microphone ----------------------------------------------------------------------------

/**
 * One button, asked once. The permission prompt is the point: granted here, it never interrupts
 * the spoken act. The device's label or the refusal is shown verbatim, and nothing here is
 * required — a machine with no microphone types its turns.
 */
function MicPassage({ model }: { model: SetupModel }) {
  const lead =
    model.mic === "granted"
      ? "The microphone answered. Hold the key in the bar, or Ctrl+Space, to talk."
      : model.mic === "denied"
        ? "The webview refused the microphone; push-to-talk stays off until it is allowed."
        : model.mic === "unsupported"
          ? "No microphone was found; every turn can still be typed."
          : "Push-to-talk needs the microphone once; asking now keeps the prompt out of a turn.";
  return (
    <>
      <p className="passage__lead">{lead}</p>
      <span className="row">
        <Button
          size="sm"
          variant={model.mic === "granted" ? "secondary" : "primary"}
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
    </>
  );
}

// -- the rail ----------------------------------------------------------------------------------

/**
 * The five stations in short. The figure that heads them is on the title row instead, so it is
 * stated once; this card is the four words a returning reader came for.
 */
function InShort({
  stations: all,
  current,
  onGo,
}: {
  stations: Station[];
  current: StepKey;
  onGo: (step: StepKey) => void;
}) {
  return (
    <SectionCard title="In short">
      <ol className="rail">
        {all.map((station) => (
          <li key={station.key}>
            <button
              type="button"
              className="rail__row focus-ring"
              aria-current={station.key === current ? "step" : undefined}
              onClick={() => onGo(station.key)}
            >
              {/* Which standing is good news is this module's domain; the dot is not. */}
              <StatusDot tone={STANDING_TONE[station.standing]} />
              <span className="rail__text">
                <span className="typo-title">{station.title}</span>
                <span className="typo-caption" style={{ overflowWrap: "anywhere" }}>
                  {station.summary}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
