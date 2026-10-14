/**
 * The Chores depth — README section 3.5, ADR 0040, 0053, 0087, 0089, 0090 and 0096.
 *
 * A pure function of `{ model, path, go }`: the place says which level is drawn. The root is the
 * catalogue (`catalogue.tsx`), a chore is its topic page (`topic.tsx`), a turn of its run is the
 * replay (`replay.tsx`). The catalogue's filters, order and last pick live here, so coming back
 * from a topic finds them as they were. A load that failed, a set on its way, an empty build, an id
 * this build does not ship, a chore with no recorded run, a turn that is not in the run: each is
 * said in words with the way back, never a crash and never a blank. Nothing here fetches or
 * reaches a store.
 */
import { useCallback, useState } from "react";

import Button from "@/components/Button";
import EmptyState from "@/components/EmptyState";
import ProblemNote from "@/components/ProblemNote";
import type { Path } from "@/depth/model";
import type { PlaybooksModel } from "@/modules/playbooks/model";

import Catalogue, { type CatalogueState } from "./catalogue";
import "./chores.css";
import { EDGE_ORDER, choreAt, chorePath, runPath, turnAt } from "./model";
import Replay from "./replay";
import Topic from "./topic";

export interface ChoresViewProps {
  model: PlaybooksModel;
  path: Path;
  go: (to: Path) => void;
}

export default function ChoresView({ model, path, go }: ChoresViewProps) {
  const [state, setState] = useState<CatalogueState>({ category: "all", job: "all", sort: EDGE_ORDER, last: null });
  const set = useCallback((s: Partial<CatalogueState>) => setState((old) => ({ ...old, ...s })), []);
  const back = useCallback(() => go({ root: "chores" }), [go]);

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
          line="A playbook is a directory under playbooks/; the bench writes its proof beside it."
        />
      </Centre>
    );
  }

  if (path.item === undefined) {
    return (
      <Catalogue
        model={model}
        state={state}
        set={set}
        open={(v) => {
          set({ last: v.id });
          go(chorePath(v.id));
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

  if (path.sub?.kind === "run") {
    const trace = view.playbook.bench?.trace ?? [];
    if (trace.length === 0) {
      return (
        <Gone
          title="There is no run to watch"
          line={
            view.playbook.bench === null
              ? "This chore is not benched, so there is no recorded run and nothing here is measured."
              : "The bench kept no turn-by-turn record of this chore's run."
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

  return <Topic key={view.id} view={view} model={model} go={go} back={back} />;
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
