/**
 * The Projects depth — README section 3.5, ADR 0087, 0090 and 0225.
 *
 * Four places of one scene. The **field** is an orrery: Athena's core is the sun, each project a
 * ring around her in its own hue with its apps riding it as moons, and the one under attention
 * takes the marquee in display type, as an app does in the Apps field. A new project is named in
 * place and lands in its own level; "All apps" is the door to every app Athena has been told about.
 * A **project** is one ring composed on its own: its name, the brief Athena reads every turn while
 * she is in it, its apps, its chores, how much it remembers, and Erase, which asks twice and says
 * what goes. **Core** is what she knows everywhere, which nothing erases. **Memory** is a project's
 * (or core's) remembered lines, by kind, with "Make core" to lift a fact or a procedure out to
 * every project.
 *
 * A pure function of `{ model, path, go }`, as every scene is. Its own state is only what is
 * hovered, what is typed, a question asked once and the memory page it fetched through the
 * model's own action. Whatever the daemon refused is said verbatim.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Facts, { Fact } from "@/components/Facts";
import FormField from "@/components/FormField";
import PillGroup from "@/components/PillGroup";
import ProblemNote from "@/components/ProblemNote";
import type { Path } from "@/depth/model";
import { ApiError } from "@/lib/api";
import { CORE, CORE_ITEM, SPACE_CAPS, type SpaceMemoryKind, type SpaceMemoryPage, type SpaceSummary } from "@/lib/spaces";
import { whenAgo } from "@/lib/time";
import { appPath } from "@/scenes/apps/model";
import AppOrb from "@/scenes/apps/orb";
import { casePath } from "@/scenes/chores/model";

import {
  briefLine,
  countsLine,
  memoryPath,
  orbitOf,
  orrery,
  plural,
  projectFor,
  projectPath,
  spaceOfItem,
  type ChoreRow,
  type Project,
  type ProjectsActions,
  type ProjectsModel,
} from "./model";
import { labelStyle, OrbitRing, Plane, projectSaid, Sun, TILT_STYLE } from "./orbit";
import "./projects.css";

export interface ProjectsViewProps {
  model: ProjectsModel;
  path: Path;
  go: (to: Path) => void;
}

export default function ProjectsView({ model, path, go }: ProjectsViewProps) {
  const id = spaceOfItem(path.item);
  if (id === null) return <Field model={model} go={go} />;
  if (path.sub?.kind === "memory") return <MemoryLevel key={id} model={model} id={id} go={go} />;
  if (id === CORE) return <CoreLevel model={model} go={go} />;
  const project = projectFor(model, id);
  if (!project) return <Missing model={model} id={id} go={go} />;
  // Keyed by the project, so a draft typed in one is never shown in another.
  return <ProjectLevel key={id} model={model} project={project} go={go} />;
}

/** A refusal in the daemon's own words: its reason, then what it said, when that differs. */
export function refusalOf(error: unknown): string {
  if (error instanceof ApiError) return error.message && error.message !== error.reason ? `${error.reason}: ${error.message}` : error.reason;
  return error instanceof Error ? error.message : String(error);
}

const nameOf = (s: SpaceSummary): string => s.name || "Untitled project";

/** Where Athena is filing her turns, in a few words: a project's name, or core. */
function whereSaid(model: ProjectsModel, id: string): string {
  if (id === CORE) return "core";
  const p = projectFor(model, id);
  return p ? nameOf(p.space) : "a project";
}

// -- the field -------------------------------------------------------------------------------------

function Field({ model, go }: { model: ProjectsModel; go: (to: Path) => void }) {
  const { projects, loaded, problem } = model;
  // The id under the pointer or the focus: a space id, `core` for the sun, or null.
  const [focused, setFocused] = useState<string | null>(null);
  const hot = focused !== null && focused !== CORE_ITEM ? projectFor(model, focused) : null;
  const sunHot = focused === CORE_ITEM;
  const none = loaded && !problem && projects.length === 0;
  const { rings, rest } = useMemo(() => orrery(projects), [projects]);

  const attend = (key: string) => ({
    onMouseEnter: () => setFocused(key),
    onMouseLeave: () => setFocused((f) => (f === key ? null : f)),
    onFocus: () => setFocused(key),
    onBlur: () => setFocused((f) => (f === key ? null : f)),
  });

  const where =
    model.pending !== null
      ? { tone: "pending" as const, words: `switches to ${whereSaid(model, model.pending)} after this turn` }
      : { tone: model.activeId === CORE ? ("neutral" as const) : ("info" as const), words: `Athena is in ${whereSaid(model, model.activeId)}` };

  return (
    <div className="projects projects--field">
      <header className="projects__head">
        <p className="projects__eyebrow">{hot ? countsLine(hot) : sunHot ? "Athena's core" : "Projects"}</p>
        <h1 className="projects__marquee">{hot ? nameOf(hot.space) : sunHot ? "Core" : "Your projects"}</h1>
        <p className="projects__line" aria-live="polite">
          {hot
            ? briefLine(hot.space.brief) || "No brief yet. Open it and tell Athena what she is for here."
            : sunHot
              ? "What Athena knows everywhere. Every project reads it, and erasing one never touches it."
              : "Each one keeps its own memory. Core is what Athena knows everywhere."}
        </p>
        <div className="projects__badges">
          <Badge tone={problem ? "error" : loaded ? (projects.length ? "success" : "neutral") : "pending"}>
            {problem ? "could not be read" : loaded ? plural(projects.length, "project") : "reading"}
          </Badge>
          {loaded && !problem ? <Badge tone={where.tone}>{where.words}</Badge> : null}
        </div>
      </header>

      {problem ? (
        <ProblemNote title="Your projects could not be read, so only Athena's core is drawn." reason={problem} />
      ) : null}

      <div className="orrery" style={TILT_STYLE} data-lonely={rings.length === 0 ? "1" : undefined}>
        <Plane>
          {rings.map(({ project, orbit }) => (
            <OrbitRing
              key={project.space.id}
              project={project}
              orbit={orbit}
              hot={focused === project.space.id}
              dim={focused !== null && focused !== project.space.id}
            />
          ))}
        </Plane>
        <div className="orrery__names" role="group" aria-label="Your projects, around Athena's core">
          <button
            type="button"
            className="orrery__sun focus-ring"
            data-hot={sunHot ? "1" : undefined}
            data-dim={focused !== null && !sunHot ? "1" : undefined}
            aria-label={`Athena's core: what she knows everywhere.${model.activeId === CORE ? " Athena is working in it." : ""} Open it.`}
            onClick={() => go(projectPath(CORE))}
            {...attend(CORE_ITEM)}
          >
            <Sun projects={projects} />
            <span className="orrery__sun-name">Core</span>
          </button>
          {rings.map(({ project, orbit }) => {
            const key = project.space.id;
            return (
              <button
                key={key}
                type="button"
                className="orrery__name focus-ring"
                style={labelStyle(orbit, project.space.hue)}
                data-hot={focused === key ? "1" : undefined}
                data-dim={focused !== null && focused !== key ? "1" : undefined}
                data-active={project.active ? "1" : undefined}
                aria-label={projectSaid(project, { shown: orbit.moons.length })}
                onClick={() => go(projectPath(key))}
                {...attend(key)}
              >
                <span className="orrery__dot" aria-hidden="true" />
                <span className="orrery__label">{nameOf(project.space)}</span>
                {project.active ? <span className="orrery__here">here</span> : null}
                <span className="orrery__caption">{`${plural(project.apps.length, "app")} · ${plural(project.memories, "memory", "memories")}`}</span>
              </button>
            );
          })}
        </div>
        {none ? (
          <p className="orrery__invite typo-body">
            No project yet. Make one for a part of your life Athena helps with: what she learns there stays there.
          </p>
        ) : null}
      </div>

      {rest.length > 0 ? (
        <section className="projects__rest" aria-labelledby="projects-rest">
          <h2 id="projects-rest" className="projects__section-title">
            {`The rest (showing ${rings.length} of ${projects.length} as rings)`}
          </h2>
          <ul className="projects__chips">
            {rest.map((p) => (
              <li key={p.space.id}>
                <button
                  type="button"
                  className="projects__chip focus-ring"
                  style={{ ["--hue" as string]: p.space.hue }}
                  aria-label={projectSaid(p)}
                  onClick={() => go(projectPath(p.space.id))}
                >
                  <span className="orrery__dot" aria-hidden="true" />
                  {nameOf(p.space)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loaded && !problem ? (
        <p className="typo-caption" role="status">
          Reading your projects…
        </p>
      ) : null}

      <div className="projects__acts">
        <NewProject lead={none} create={model.actions.create} go={go} />
        <div className="projects__door">
          <Button variant="secondary" onClick={() => go({ root: "apps" })}>
            All apps
          </Button>
          <p className="typo-caption">Every app Athena has been told about, in a project or not.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * A project is named in place: a name is all it needs, and Enter makes it and goes to its level.
 * `lead` is the empty field, where this is the only act there is.
 */
function NewProject({ lead, create, go }: { lead: boolean; create: ProjectsActions["create"]; go: (to: Path) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const typed = name.trim();
  const submit = () => {
    if (typed === "" || busy) return;
    setBusy(true);
    setProblem(null);
    create({ name: typed }).then(
      (made) => {
        setBusy(false);
        setName("");
        go(projectPath(made.id));
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(refusalOf(error));
      },
    );
  };
  return (
    <section className={lead ? "projects__new projects__new--lead" : "projects__new"} aria-labelledby="projects-new">
      <h2 id="projects-new" className="projects__new-title">
        New project
      </h2>
      <div className="projects__new-row">
        <input
          className="projects__input focus-ring"
          value={name}
          maxLength={SPACE_CAPS.name}
          placeholder="Renovation"
          aria-label="Name of the new project"
          aria-describedby="projects-new-note"
          spellCheck={false}
          autoFocus={lead}
          onChange={(e) => {
            setName(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            // As the Apps field's box: the first Escape drops what was typed, the next lets go.
            if (e.key === "Escape") {
              if (name !== "") setName("");
              else e.currentTarget.blur();
            }
          }}
        />
        <Button variant="primary" disabledReason={typed === "" ? "Name it first." : busy ? "Making it…" : undefined} onClick={submit}>
          Create
        </Button>
      </div>
      {problem ? (
        <p id="projects-new-note" className="typo-caption projects__refusal" role="alert">
          {`It was not made: ${problem}`}
        </p>
      ) : (
        <p id="projects-new-note" className="typo-caption">
          {`A name is enough; the brief and the apps come after. ${name.length}/${SPACE_CAPS.name}`}
        </p>
      )}
    </section>
  );
}

// -- one project ----------------------------------------------------------------------------------

/** The project's own ring and the sun, drawn small beside its level. Decorative. */
function Portrait({ projects, only }: { projects: readonly Project[]; only?: Project }) {
  // Alone, the project's ring is drawn where the third of three would be: wide enough for its moons.
  const drawn = only ? [{ project: only, orbit: orbitOf(only, 2, 3) }] : orrery(projects).rings;
  return (
    <div className="orrery orrery--portrait" style={TILT_STYLE} aria-hidden="true">
      <Plane>
        {drawn.map(({ project, orbit }) => (
          <OrbitRing key={project.space.id} project={project} orbit={orbit} hot={Boolean(only)} />
        ))}
      </Plane>
      <span className="orrery__sun orrery__sun--still">
        <Sun projects={only ? [only] : projects} />
      </span>
    </div>
  );
}

function ProjectLevel({ model, project, go }: { model: ProjectsModel; project: Project; go: (to: Path) => void }) {
  const { space } = project;
  const { actions } = model;
  return (
    <div className="projects projects--project" style={{ ["--hue" as string]: space.hue }}>
      <div className="projects__art">
        <Portrait projects={model.projects} only={project} />
        <p className="projects__stylised">Stylised drawing: its ring around Athena, its apps as moons.</p>
      </div>

      <div className="projects__detail">
        <p className="projects__eyebrow">Project</p>
        <Name space={space} rename={(name) => actions.update(space.id, { name })} />
        <p className="projects__line projects__line--short">{countsLine(project)}</p>
        <div className="projects__badges">
          {project.active ? (
            <Badge tone="info">Athena is working in this project</Badge>
          ) : project.pending ? (
            <Badge tone="pending">Athena switches to this project after this turn</Badge>
          ) : (
            <Badge tone="neutral">{`Athena is in ${whereSaid(model, model.activeId)}`}</Badge>
          )}
        </div>

        <Brief space={space} save={(brief) => actions.update(space.id, { brief })} />
        <AppsSection model={model} project={project} go={go} />
        <ChoresSection model={model} project={project} go={go} />

        <section className="projects__section" aria-labelledby="projects-memory">
          <h2 id="projects-memory" className="projects__section-title">
            Memory
          </h2>
          <p className="typo-caption">What she writes while she is in this project is kept here, and read only here.</p>
          <Facts>
            <Fact label="Episodes">{space.counts.episodes.toLocaleString("en-US")}</Fact>
            <Fact label="Facts">{space.counts.facts.toLocaleString("en-US")}</Fact>
            <Fact label="Procedures">{space.counts.procedurals.toLocaleString("en-US")}</Fact>
          </Facts>
          <Button variant="secondary" onClick={() => go(memoryPath(space.id))}>
            Open its memory
          </Button>
        </section>

        <Erase
          project={project}
          erase={() =>
            actions.erase(space.id).then(() => {
              go({ root: "projects" });
            })
          }
        />
      </div>
    </div>
  );
}

/** The name, in display type; Rename turns it into a field in place. Enter or leaving it saves. */
function Name({ space, rename }: { space: SpaceSummary; rename: (name: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const rise = useRef<HTMLSpanElement>(null);
  const commit = () => {
    if (draft === null) return;
    const typed = draft.trim();
    setDraft(null);
    if (typed === "" || typed === space.name) return;
    setProblem(null);
    rename(typed).catch((error: unknown) => setProblem(refusalOf(error)));
  };
  // The field replaces the Rename button: when it closes, the focus goes back to it.
  const editing = draft !== null;
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !editing) rise.current?.querySelector("button")?.focus();
    was.current = editing;
  }, [editing]);
  return (
    <div className="projects__name">
      {editing ? (
        <span className="projects__name-row">
          <input
            className="projects__marquee projects__marquee--project projects__rename focus-ring"
            value={draft}
            maxLength={SPACE_CAPS.name}
            aria-label="The project's name"
            spellCheck={false}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
          />
          <span className="typo-caption">{`${draft.length}/${SPACE_CAPS.name}`}</span>
        </span>
      ) : (
        <span className="projects__name-row">
          <h1 className="projects__marquee projects__marquee--project">{nameOf(space)}</h1>
          <span ref={rise}>
            <Button size="sm" variant="ghost" aria-label={`Rename ${nameOf(space)}`} onClick={() => setDraft(space.name)}>
              Rename
            </Button>
          </span>
        </span>
      )}
      {problem ? (
        <p className="typo-caption projects__refusal" role="alert">
          {`The name was not changed: ${problem}`}
        </p>
      ) : null}
    </div>
  );
}

type Saving = "idle" | "saving" | "saved" | { problem: string };

/** The brief: the person's own words, which Athena reads every turn while she is in the project. */
function Brief({ space, save }: { space: SpaceSummary; save: (brief: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<Saving>("idle");
  const value = draft ?? space.brief;
  const commit = () => {
    if (draft === null || draft === space.brief) return;
    setSaving("saving");
    save(draft).then(
      () => setSaving("saved"),
      (error: unknown) => setSaving({ problem: refusalOf(error) }),
    );
  };
  return (
    <section className="projects__section projects__brief" aria-label="Brief">
      <FormField
        label="Brief"
        hint="Athena reads this every turn while you are in this project."
        error={typeof saving === "object" ? `It was not saved: ${saving.problem}` : null}
      >
        {(input) => (
          <textarea
            {...input}
            className="input typo-body focus-ring field__input projects__textarea"
            rows={5}
            maxLength={SPACE_CAPS.brief}
            value={value}
            placeholder="What is this project, and what should Athena keep in mind here?"
            onChange={(e) => {
              setDraft(e.target.value);
              if (saving !== "saving") setSaving("idle");
            }}
            onBlur={commit}
          />
        )}
      </FormField>
      <p className="projects__count typo-caption" role="status">
        <span>{`${value.length}/${SPACE_CAPS.brief}`}</span>
        <span>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved." : "Saved when you leave the box."}</span>
      </p>
    </section>
  );
}

function AppsSection({ model, project, go }: { model: ProjectsModel; project: Project; go: (to: Path) => void }) {
  const { space } = project;
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const candidates = model.registered.filter((a) => !space.apps.includes(a.origin));
  const full = space.apps.length >= SPACE_CAPS.apps;
  const setApps = (apps: readonly string[]) => {
    setProblem(null);
    model.actions.update(space.id, { apps }).catch((error: unknown) => setProblem(refusalOf(error)));
  };
  return (
    <section className="projects__section" aria-labelledby="projects-apps">
      <h2 id="projects-apps" className="projects__section-title">
        Apps
      </h2>
      {project.apps.length === 0 ? (
        <p className="typo-caption">No app in this project yet. Add one Athena has been told about, and it rides this ring.</p>
      ) : (
        <ul className="projects__apps">
          {project.apps.map((app) => (
            <li key={app.origin} className="projects__app">
              <button
                type="button"
                className="projects__app-open focus-ring"
                aria-label={`${app.host}${app.registered ? "" : ", not registered"}. Open its layer.`}
                onClick={() => go(appPath(app.origin))}
              >
                <AppOrb monogram={app.monogram} standing={app.standing} size={64} />
                <span className="projects__app-host">{app.host}</span>
              </button>
              <button
                type="button"
                className="projects__app-remove focus-ring"
                title={`Take ${app.host} out of this project`}
                aria-label={`Take ${app.host} out of ${nameOf(space)}`}
                onClick={() => setApps(space.apps.filter((o) => o !== app.origin))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="projects__row">
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={picking}
          disabledReason={
            full
              ? `A project holds at most ${SPACE_CAPS.apps} apps.`
              : model.registered.length === 0
                ? "No app is registered yet: register one under All apps."
                : candidates.length === 0
                  ? "Every app Athena knows is in this project already."
                  : undefined
          }
          onClick={() => setPicking((p) => !p)}
        >
          Add app
        </Button>
        {project.apps.length > 0 ? <span className="typo-caption">Taking one out leaves the app registered.</span> : null}
      </div>
      {picking && !full && candidates.length > 0 ? (
        <ul className="projects__picks" aria-label="Apps to add">
          {candidates.map((a) => (
            <li key={a.origin}>
              <button
                type="button"
                className="projects__pick focus-ring"
                onClick={() => {
                  setPicking(false);
                  setApps([...space.apps, a.origin]);
                }}
              >
                {`+ ${a.host}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="typo-caption projects__refusal" role="alert">
          {`The apps were not changed: ${problem}`}
        </p>
      ) : null}
    </section>
  );
}

function ChoresSection({ model, project, go }: { model: ProjectsModel; project: Project; go: (to: Path) => void }) {
  const { space } = project;
  const { chores } = model;
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const candidates = chores.rows.filter((c) => c.spaceId !== space.id);
  const link = (row: ChoreRow, to: string) => {
    setProblem(null);
    model.actions.linkCase(row.caseId, to).catch((error: unknown) => setProblem(refusalOf(error)));
  };
  return (
    <section className="projects__section" aria-labelledby="projects-chores">
      <h2 id="projects-chores" className="projects__section-title">
        Chores
      </h2>
      {chores.problem ? (
        <p className="typo-caption">
          Your chores could not be read: <code className="typo-code">{chores.problem}</code>
        </p>
      ) : !chores.loaded ? (
        <p className="typo-caption" role="status">
          Reading your chores…
        </p>
      ) : project.chores.length === 0 ? (
        <p className="typo-caption">No chore is linked to this project yet.</p>
      ) : (
        <ul className="projects__chores">
          {project.chores.map((c) => (
            <li key={c.caseId} className="projects__chore">
              <button type="button" className="projects__chore-open focus-ring" onClick={() => go(casePath(c.playbookId, c.caseId))}>
                {c.title}
              </button>
              <Button size="sm" variant="ghost" aria-label={`Unlink ${c.title}: it goes back to core`} onClick={() => link(c, CORE)}>
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="projects__row">
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={picking}
          disabledReason={
            chores.problem
              ? "Your chores could not be read."
              : !chores.loaded
                ? "Reading your chores…"
                : candidates.length === 0
                  ? "You have no other chore to link."
                  : undefined
          }
          onClick={() => setPicking((p) => !p)}
        >
          Link a chore
        </Button>
        <Button size="sm" variant="ghost" onClick={() => go({ root: "chores" })}>
          Adopt one here
        </Button>
        <span className="typo-caption">Opens the chores with this project active.</span>
      </div>
      {chores.footer ? <p className="typo-caption">{`Your chores ${chores.footer}`}</p> : null}
      {picking && candidates.length > 0 ? (
        <ul className="projects__picks" aria-label="Chores to link">
          {candidates.map((c) => (
            <li key={c.caseId}>
              <button
                type="button"
                className="projects__pick focus-ring"
                onClick={() => {
                  setPicking(false);
                  link(c, space.id);
                }}
              >
                {`+ ${c.title}`}
                <span className="projects__pick-where">{c.spaceId === CORE ? "in core" : `in ${whereSaid(model, c.spaceId)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className="typo-caption projects__refusal" role="alert">
          {`The chore was not moved: ${problem}`}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Erase asks twice: the first press asks, and the second is a button that says what goes. Its
 * memory goes with it for good; its chores survive, back in core.
 */
function Erase({ project, erase }: { project: Project; erase: () => Promise<unknown> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const moved = useRef(false);
  // The pressed button is replaced by the question, so the focus would fall to the document: the
  // safe answer (Keep it) takes it, and the way in takes it back when the question is withdrawn.
  useEffect(() => {
    if (!moved.current) return;
    const buttons = section.current?.querySelectorAll("button");
    (asking ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus();
  }, [asking]);
  const ask = (next: boolean) => {
    moved.current = true;
    setAsking(next);
  };
  const said = `Erase ${plural(project.memories, "memory", "memories")} and unlink ${plural(project.space.counts.chores, "chore")} — this cannot be undone`;
  const go = () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    erase().catch((error: unknown) => {
      setBusy(false);
      setProblem(refusalOf(error));
    });
  };
  return (
    <section ref={section} className="projects__section projects__erase" aria-labelledby="projects-erase">
      <h2 id="projects-erase" className="projects__section-title">
        Erase
      </h2>
      <p className="typo-caption">Its brief, its list of apps and every memory written in it go. Its chores stay, back in core.</p>
      {asking ? (
        <span className="projects__row">
          <span className="typo-caption">{`Erase ${nameOf(project.space)}?`}</span>
          <Button size="sm" variant="primary" disabledReason={busy ? "Erasing…" : undefined} onClick={go}>
            {said}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ask(false)}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" aria-label={`Erase ${nameOf(project.space)}`} onClick={() => ask(true)}>
          Erase this project
        </Button>
      )}
      {problem ? (
        <p className="typo-caption projects__refusal" role="alert">
          {`It was not erased: ${problem}`}
        </p>
      ) : null}
    </section>
  );
}

// -- core ------------------------------------------------------------------------------------------

function CoreLevel({ model, go }: { model: ProjectsModel; go: (to: Path) => void }) {
  const here = model.activeId === CORE;
  return (
    <div className="projects projects--project projects--core">
      <div className="projects__art">
        <Portrait projects={model.projects} />
        <p className="projects__stylised">Stylised drawing: every project around Athena's core.</p>
      </div>
      <div className="projects__detail">
        <p className="projects__eyebrow">Athena's core</p>
        <h1 className="projects__marquee projects__marquee--project">Core</h1>
        <p className="projects__line projects__line--short">
          What Athena knows everywhere. What she learns outside every project is kept here, and every project reads it; what
          she learns inside a project stays in that project.
        </p>
        <div className="projects__badges">
          {here ? (
            <Badge tone="info">Athena is working in core</Badge>
          ) : model.pending === CORE ? (
            <Badge tone="pending">Athena comes back to core after this turn</Badge>
          ) : (
            <Badge tone="neutral">{`Athena is in ${whereSaid(model, model.activeId)}`}</Badge>
          )}
        </div>
        <section className="projects__section" aria-labelledby="projects-core-memory">
          <h2 id="projects-core-memory" className="projects__section-title">
            Memory
          </h2>
          <p className="typo-caption">Core has no brief and cannot be erased.</p>
          <Button variant="secondary" onClick={() => go(memoryPath(CORE))}>
            Open core's memory
          </Button>
        </section>
        {model.projects.length > 0 ? (
          <section className="projects__section" aria-labelledby="projects-core-list">
            <h2 id="projects-core-list" className="projects__section-title">
              Around it
            </h2>
            <ul className="projects__chips">
              {model.projects.map((p) => (
                <li key={p.space.id}>
                  <button
                    type="button"
                    className="projects__chip focus-ring"
                    style={{ ["--hue" as string]: p.space.hue }}
                    aria-label={projectSaid(p)}
                    onClick={() => go(projectPath(p.space.id))}
                  >
                    <span className="orrery__dot" aria-hidden="true" />
                    {nameOf(p.space)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

// -- memory ----------------------------------------------------------------------------------------

type KindFilter = "all" | SpaceMemoryKind;

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "all" },
  { value: "episode", label: "episodes" },
  { value: "fact", label: "facts" },
  { value: "procedural", label: "procedures" },
];

const KIND_ONE: Record<SpaceMemoryKind, string> = { episode: "episode", fact: "fact", procedural: "procedure" };

type Page = { kind: "reading" } | { kind: "read"; page: SpaceMemoryPage } | { kind: "failed"; problem: string };

/** A project's (or core's) memory: the rows the daemon answers, by kind. */
function MemoryLevel({ model, id, go }: { model: ProjectsModel; id: string; go: (to: Path) => void }) {
  const core = id === CORE;
  const project = core ? null : projectFor(model, id);
  const [kind, setKind] = useState<KindFilter>("all");
  // Bumped after a row is made core, so the page is asked for again.
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState<{ for: string; page: Page } | null>(null);
  const ask = `${id}|${kind}|${round}`;
  const read = model.actions.memory;
  const known = core || project !== null;
  useEffect(() => {
    if (!known) return;
    let live = true;
    read(core ? CORE_ITEM : id, kind === "all" ? undefined : kind).then(
      (page) => live && setAnswer({ for: ask, page: { kind: "read", page } }),
      (error: unknown) => live && setAnswer({ for: ask, page: { kind: "failed", problem: refusalOf(error) } }),
    );
    return () => {
      live = false;
    };
  }, [read, core, id, kind, ask, known]);

  if (!known) return <Missing model={model} id={id} go={go} />;
  const page: Page = answer?.for === ask ? answer.page : { kind: "reading" };
  const title = core ? "Core" : nameOf(project!.space);

  return (
    <div className="projects projects--memory" style={project ? { ["--hue" as string]: project.space.hue } : undefined}>
      <header className="projects__head">
        <p className="projects__eyebrow">{core ? "What Athena knows everywhere" : `What she keeps for ${title}`}</p>
        <h1 className="projects__marquee projects__marquee--project">{`${title}'s memory`}</h1>
        <p className="projects__line projects__line--short">
          {core
            ? "Every project reads these. What she learned inside a project is in that project's memory."
            : "Read only while Athena is in this project. Make a fact or a procedure core, and every project reads it."}
        </p>
      </header>
      <PillGroup ariaLabel="Which memories" value={kind} onChange={setKind} options={KIND_OPTIONS} />
      {page.kind === "reading" ? (
        <p className="typo-caption" role="status">
          Reading the memory…
        </p>
      ) : page.kind === "failed" ? (
        <ProblemNote title="This memory could not be read." reason={page.problem} onRetry={() => setRound((r) => r + 1)} />
      ) : page.page.rows.length === 0 ? (
        <p className="typo-caption">
          {kind === "all" ? "Nothing remembered here yet." : `No ${KIND_OPTIONS.find((o) => o.value === kind)!.label} here yet.`}
        </p>
      ) : (
        <>
          <ul className="projects__memory">
            {page.page.rows.map((row) => (
              <li key={row.id} className="projects__memory-row" data-kind={row.kind}>
                <span className="projects__kind">{KIND_ONE[row.kind]}</span>
                <p className="projects__memory-line">{row.line}</p>
                <span className="projects__memory-when typo-caption">{whenAgo(row.created)}</span>
                {!core && row.kind !== "episode" ? (
                  <MakeCore
                    what={KIND_ONE[row.kind]}
                    promote={() => model.actions.promote(id, row.id).then(() => setRound((r) => r + 1))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {page.page.showing < page.page.total ? (
            <p className="typo-caption">{`(showing ${page.page.showing} of ${page.page.total})`}</p>
          ) : null}
        </>
      )}
      <div className="projects__row">
        <Button variant="ghost" onClick={() => go(projectPath(id))}>
          {`Back to ${title}`}
        </Button>
      </div>
    </div>
  );
}

/** "Make core" asks once: a line made core is read in every project from then on. */
function MakeCore({ what, promote }: { what: string; promote: () => Promise<unknown> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const yes = () => {
    setBusy(true);
    setProblem(null);
    promote().then(
      () => {
        setBusy(false);
        setAsking(false);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(refusalOf(error));
      },
    );
  };
  return (
    <span className="projects__make-core">
      {asking ? (
        <>
          <span className="typo-caption">{`Every project will read this ${what}.`}</span>
          <Button size="sm" variant="primary" disabledReason={busy ? "Moving it…" : undefined} onClick={yes}>
            Make it core
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Keep it here
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
          Make core
        </Button>
      )}
      {problem ? (
        <span className="typo-caption projects__refusal" role="alert">
          {`It stays here: ${problem}`}
        </span>
      ) : null}
    </span>
  );
}

// -- not here ----------------------------------------------------------------------------------------

function Missing({ model, id, go }: { model: ProjectsModel; id: string; go: (to: Path) => void }) {
  return (
    <div className="projects projects--project projects--missing">
      <div className="projects__detail">
        <p className="projects__eyebrow">Projects</p>
        {model.loaded ? (
          <>
            <h1 className="projects__marquee projects__marquee--project">No such project</h1>
            <p className="projects__line projects__line--short">
              {`Athena has no project called ${id}. It may have been erased; its chores went back to core.`}
            </p>
          </>
        ) : (
          <>
            <h1 className="projects__marquee projects__marquee--project">Reading your projects…</h1>
            <p className="projects__line projects__line--short">The list has not answered yet.</p>
          </>
        )}
        <Button variant="secondary" onClick={() => go({ root: "projects" })}>
          Back to your projects
        </Button>
      </div>
    </div>
  );
}
