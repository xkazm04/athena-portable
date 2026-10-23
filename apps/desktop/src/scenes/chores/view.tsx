/**
 * The Chores depth — README section 3.5, ADR 0040, 0053, 0087, 0089, 0090 and 0096.
 *
 * A pure function of `{ model, path, go }`: the place says which level is drawn. The root is the
 * catalogue (`catalogue.tsx`), a chore is its topic page (`topic.tsx`), a turn of its run is the
 * replay (`replay.tsx`), and its "Make it yours" is the Adopt studio (`adopt/studio.tsx`, ADR 0097),
 * the one level that talks to the daemon, through the deps it is handed (the topic page asks the same
 * deps only for the saved cases it names, ADR 0123). The stage mounts a fresh
 * view at every move, so the catalogue's filters, order and last pick, the front door's words and
 * each topic's scroll are kept in `memory.ts`, and coming back finds them as they were. A load that
 * failed, a set on its way, an empty build, an id this build does not ship, a chore with no
 * recorded run, a turn that is not in the run: each is said in words with the way back, never a
 * crash and never a blank. Nothing here fetches.
 */
import { useCallback, useEffect } from "react";

import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import ProblemNote from "@/components/ProblemNote";
import type { Path } from "@/depth/model";
import type { PlaybooksModel } from "@/modules/playbooks/model";

import type { AdoptDeps } from "./adopt/deps";
import Studio from "./adopt/studio";
import Intake from "./intake/intake";
import Catalogue from "./catalogue";
import "./chores.css";
import { NEW_ITEM, adoptPath, choreAt, chorePath, newChorePath, runPath, turnAt } from "./model";
import { rememberCatalogue, rememberIntro, scrolls, useChoresMemory } from "./memory";
import Replay from "./replay";
import Topic from "./topic";

export interface ChoresViewProps {
  model: PlaybooksModel;
  path: Path;
  go: (to: Path) => void;
  /** The Adopt studio's client and dictation; absent, the studio says it needs the daemon. */
  adopt?: AdoptDeps;
  /** Athena's composer (`athenaOffer`), for a custom verdict; without it the front door offers Copy. */
  offer?: (text: string) => Promise<void>;
}

export default function ChoresView({ model, path, go, adopt, offer }: ChoresViewProps) {
  // The stage mounts a fresh view at every move, so what must outlive one lives in `memory.ts`.
  const { catalogue: state, intro } = useChoresMemory();
  const back = useCallback(() => go({ root: "chores" }), [go]);
  const openAdopt = useCallback(
    (id: string, text: string) => {
      rememberIntro({ id, text });
      go(adoptPath(id));
    },
    [go],
  );
  // Opening a chore afresh (from a row, or from the front door) starts its page at the top.
  const openChore = useCallback(
    (id: string) => {
      scrolls.delete(id);
      go(chorePath(id));
    },
    [go],
  );
  // Back on the catalogue or a chore's page, what was said is spent: a later studio starts clean.
  const spent = path.item === undefined || (path.item !== NEW_ITEM && path.sub === undefined);
  useEffect(() => {
    if (spent) rememberIntro(null);
  }, [spent]);

  if (model.problem !== null) {
    return (
      <Centre>
        <ProblemNote title="The playbooks could not be read." reason={model.problem} />
      </Centre>
    );
  }
  if (model.loading) {
    return (
      <Centre>
        <EmptyState title="Loading the playbooks" line="They are fetched the first time they are asked for." />
      </Centre>
    );
  }
  if (model.items.length === 0) {
    return (
      <Centre>
        <EmptyState
          title="No playbooks in this build"
          line="A playbook is a directory under playbooks/; its test run writes its proof beside it."
        />
      </Centre>
    );
  }

  // "new" is reserved: the front door, before any chore is looked up.
  if (path.item === NEW_ITEM) {
    return <Intake deps={adopt} model={model} back={back} openAdopt={openAdopt} openChore={openChore} offer={offer} />;
  }

  if (path.item === undefined) {
    return (
      <Catalogue
        model={model}
        state={state}
        set={rememberCatalogue}
        create={() => go(newChorePath())}
        open={(v) => {
          rememberCatalogue({ last: v.id });
          openChore(v.id);
        }}
      />
    );
  }

  const view = choreAt(model, path);
  if (view === null) {
    return (
      <Centre>
        <EmptyState
          title="That playbook is not in this build"
          line={`There is no playbook called "${path.item}" here. It may have been renamed.`}
          action={
            <Button variant="primary" onClick={back}>
              All playbooks
            </Button>
          }
        />
      </Centre>
    );
  }

  if (path.sub?.kind === "adopt") {
    return (
      <Studio
        key={view.id}
        view={view}
        model={model}
        deps={adopt}
        back={() => go(chorePath(view.id))}
        intro={intro?.id === view.id ? intro.text : undefined}
      />
    );
  }

  // The studio on a saved case (ADR 0123): the case's slots and approved brief, no re-interview.
  if (path.sub?.kind === "case") {
    return (
      <Studio
        key={`${view.id}/${path.sub.arg ?? ""}`}
        view={view}
        model={model}
        deps={adopt}
        back={() => go(chorePath(view.id))}
        caseId={path.sub.arg}
      />
    );
  }

  if (path.sub?.kind === "run") {
    const trace = view.playbook.bench?.trace ?? [];
    if (trace.length === 0) {
      return (
        <Gone
          title="There is no run to watch"
          line={
            view.playbook.bench === null
              ? "This chore is not tested yet, so there is no recorded run and nothing here is measured."
              : "Its test run kept no turn-by-turn record."
          }
          action={
            <Button variant="primary" onClick={() => go(chorePath(view.id))}>
              Back to the chore
            </Button>
          }
        />
      );
    }
    const turn = turnAt(path, trace.length);
    if (turn === null) {
      return (
        <Gone
          title="That turn is not in this run"
          line={`The run has ${trace.length} turns; there is no turn "${path.sub.arg ?? ""}".`}
          action={
            <Button variant="primary" onClick={() => go(runPath(view.id, 0))}>
              Go to turn 1
            </Button>
          }
        />
      );
    }
    return <Replay view={view} turn={turn} go={go} />;
  }

  return <Topic key={view.id} view={view} model={model} go={go} back={back} deps={adopt} />;
}

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="pa-page pa-page--center">{children}</div>;
}

function Gone({ title, line, action }: { title: string; line: string; action: React.ReactNode }) {
  return (
    <div className="chores ch-gone" role="status">
      <h1 className="ch-marquee ch-marquee--chore">{title}</h1>
      <p className="ch-line">{line}</p>
      {action}
    </div>
  );
}
