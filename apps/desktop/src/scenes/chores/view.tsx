/**
 * The Chores depth — README section 3.5, ADR 0040, 0053, 0087, 0089 and 0090.
 *
 * A pure function of `{ model, path, go }`: the place says which level is drawn. The root is the
 * field of chores (`field.tsx`), a chore is its own composed scene (`chore.tsx`), a turn of its run
 * is the replay (`replay.tsx`). An id this build does not ship, a chore with no recorded run, a
 * turn that is not in the run: each is said in words with the way back, never a crash and never a
 * blank. The module's model is the behaviour; nothing here fetches or reaches a store.
 */
import Button from "@/components/Button";
import type { Path } from "@/depth/model";
import type { FacetId, PlaybooksModel } from "@/modules/playbooks/model";

import Chore from "./chore";
import "./chores.css";
import Field from "./field";
import { choreAt, chorePath, runPath, turnAt } from "./model";
import Replay from "./replay";

export interface ChoresViewProps {
  model: PlaybooksModel;
  path: Path;
  go: (to: Path) => void;
  /** Preview only: the facet a chore opens on. */
  initialFacet?: FacetId | null;
}

export default function ChoresView({ model, path, go, initialFacet = null }: ChoresViewProps) {
  if (path.item === undefined) return <Field model={model} go={go} />;

  const view = choreAt(model, path);
  if (view === null) {
    return (
      <Gone
        title="That chore is not in this build"
        line={`There is no playbook called "${path.item}" here. It may have been renamed, or it ships in a different build.`}
        action={
          <Button variant="primary" onClick={() => go({ root: "chores" })}>
            All chores
          </Button>
        }
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

  return <Chore key={view.id} view={view} model={model} go={go} initialFacet={initialFacet} />;
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
