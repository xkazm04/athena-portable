/**
 * The Projects depth's lazy chunk in the running app — README section 3.5, ADR 0089, 0123 and 0225.
 *
 * Three sources, read and joined by the model, nothing kept here: the spaces store (its list,
 * which space is active and which waits, its actions), the Browser module's registered apps (their
 * monograms and standing, for the moons and "Add app", handed in by `live.tsx`, which reads the
 * Browser module in the first frame), and the person's saved chores through the
 * client the Chores scene's studio uses (`GET /adopt/cases`, every playbook's). The list of
 * projects is read again each time the depth is entered, because its counts move with every turn
 * Athena takes; the chores are read again after one is linked or unlinked.
 *
 * And the one behaviour a place has here: **entering a project is entering it.** A path at
 * `projects/<id>` (or any place under it) asks the spaces store to make that space the active one,
 * and `projects/core` returns Athena to core; the store holds the switch while a turn runs
 * (`pending`). An id the list does not hold is never made active, so a stale link cannot file a
 * turn under a space that is gone.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Path } from "@/depth/model";
import { AdoptApi } from "@/lib/adopt-client";
import { CORE, CORE_ITEM } from "@/lib/spaces";
import type { RegisteredApp } from "@/modules/browser/model";
import type { SceneProps } from "@/scenes/types";
import { endpoint, useDaemon } from "@/stores/daemon";
import { useSpaces } from "@/stores/spaces";

import { selectProjects, type ChoresState, type ProjectsActions } from "./model";
import ProjectsView, { refusalOf } from "./view";

const at = () => endpoint(useDaemon.getState());

const NOT_YET: ChoresState = { loaded: false, problem: "", rows: [], footer: "" };

/** The person's saved chores, read on entry and again whenever `round` moves. */
function useChores(round: number): ChoresState {
  const [state, set] = useState<ChoresState>(NOT_YET);
  useEffect(() => {
    let live = true;
    new AdoptApi(at).cases("").then(
      (reply) =>
        live &&
        set({
          loaded: true,
          problem: "",
          footer: reply.footer,
          rows: reply.cases.map((c) => ({ caseId: c.case_id, playbookId: c.playbook_id, title: c.title || c.playbook_id, spaceId: c.space_id })),
        }),
      (error: unknown) => live && set({ ...NOT_YET, loaded: true, problem: refusalOf(error) }),
    );
    return () => {
      live = false;
    };
  }, [round]);
  return state;
}

/** The space a path under Projects asks to be in: `CORE` for core, the id, or null for the field. */
export function spaceAsked(path: Path): string | null {
  if (path.root !== "projects" || path.item === undefined || path.item === "") return null;
  return path.item === CORE_ITEM ? CORE : path.item;
}

/** Make the space the path names the active one, once the list says it exists. */
export function useEnterSpace(path: Path): void {
  const asked = spaceAsked(path);
  const loaded = useSpaces((s) => s.loaded);
  const known = useSpaces((s) => asked !== null && (asked === CORE || s.spaces.some((x) => x.id === asked)));
  const setActive = useSpaces((s) => s.setActive);
  useEffect(() => {
    if (asked === null || !known) return;
    if (asked !== CORE && !loaded) return;
    const { activeId, pending } = useSpaces.getState();
    // Already there, with no other switch waiting: asking again would only write the same setting.
    if (activeId === asked && pending === null) return;
    setActive(asked);
  }, [asked, known, loaded, setActive]);
}

export default function ProjectsLiveView({
  path,
  go,
  registered,
}: SceneProps & { registered: readonly RegisteredApp[] }) {
  useEnterSpace(path);
  const spaces = useSpaces((s) => s.spaces);
  const loaded = useSpaces((s) => s.loaded);
  const problem = useSpaces((s) => s.problem);
  const activeId = useSpaces((s) => s.activeId);
  const pending = useSpaces((s) => s.pending);
  const create = useSpaces((s) => s.create);
  const update = useSpaces((s) => s.update);
  const erase = useSpaces((s) => s.erase);
  const memory = useSpaces((s) => s.memory);
  const promote = useSpaces((s) => s.promote);
  const link = useSpaces((s) => s.linkCase);
  const [round, setRound] = useState(0);
  const chores = useChores(round);

  useEffect(() => {
    void useSpaces.getState().load();
  }, []);

  const linkCase = useCallback(
    (caseId: string, spaceId: string) => link(caseId, spaceId).finally(() => setRound((r) => r + 1)),
    [link],
  );
  const actions: ProjectsActions = useMemo(
    () => ({ create, update, erase, memory, promote, linkCase }),
    [create, update, erase, memory, promote, linkCase],
  );

  const model = useMemo(
    () => selectProjects({ spaces, loaded, problem, activeId, pending, registered, chores, actions }),
    [spaces, loaded, problem, activeId, pending, registered, chores, actions],
  );
  return <ProjectsView model={model} path={path} go={go} />;
}
