/**
 * @catalog The Project she works in: hue dot and name (or "Core"), a menu to switch, and the chip.
 *
 * README section 3.5, ADR 0225. Every turn is filed under one Project (wire: space) or under
 * Athena's core, and the memory she writes there is walled off with it, so where she is working
 * must be on screen wherever the person talks to her: Main's chrome bar and beside her composer.
 * Both draw this pill, so the two windows say the same thing about the same fact.
 *
 * The pill is a button whose accessible name names the active Project; it opens a small menu of
 * the Projects, "Back to core" and, where the caller can go there, "All projects". A switch asked
 * for while a turn runs is not applied until the turn ends (the memory of a turn stays in the
 * Project it started in), and the pill says so: "switches after this turn". Escape closes the menu
 * and is claimed, so neither the stage behind it rises nor her window folds.
 *
 * {@link ProjectChip} is the same dot and name, inert, for the places that list which Project a
 * thing belongs to (an app's "In projects", a chore's case). Pure: the caller hands the list and
 * the acts; nothing here reads a store.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import "./project-pill.css";

/** What the pill and the chip need of a Project. `lib/spaces.ts`'s `SpaceSummary` is one. */
export interface PillSpace {
  id: string;
  name: string;
  hue: number;
}

/** Core's word on the pill. */
export const CORE_WORD = "Core";
/** What a held switch says until the turn ends. */
export const PENDING_WORD = "switches after this turn";

const hueStyle = (hue: number) => ({ "--project-hue": String(hue) }) as CSSProperties;

/** The hue dot alone: a Project's colour, or core's neutral ring when `hue` is null. */
export function ProjectDot({ hue }: { hue: number | null }) {
  return hue === null ? (
    <span className="project-dot project-dot--core" aria-hidden="true" />
  ) : (
    <span className="project-dot" style={hueStyle(hue)} aria-hidden="true" />
  );
}

/** A Project as an inert chip, or a button when `onClick` is given. */
export function ProjectChip({ space, onClick, label }: { space: PillSpace; onClick?: () => void; label?: string }) {
  const body = (
    <>
      <ProjectDot hue={space.hue} />
      <span className="project-chip__name">{space.name}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="project-chip project-chip--button focus-ring" onClick={onClick} aria-label={label}>
      {body}
    </button>
  ) : (
    <span className="project-chip">{body}</span>
  );
}

export interface ProjectPillProps {
  spaces: readonly PillSpace[];
  /** The active id; `""` is core. */
  activeId: string;
  /** A switch waiting for the turn to end, or `null`. */
  pending: string | null;
  /** Switch to a Project, or to core with `""`. */
  onPick: (id: string) => void;
  /** "All projects"; left out where the window cannot go there. */
  onAll?: () => void;
  /** `true` for the narrow composer row: the pending line folds into the title. */
  compact?: boolean;
}

/** "Taxes", or "Core" for core and for an id the list does not name (the store says core then too). */
export function nameOf(spaces: readonly PillSpace[], id: string | null): string {
  if (!id) return CORE_WORD;
  return spaces.find((s) => s.id === id)?.name ?? CORE_WORD;
}

/** The pill's accessible name: where she works, and where she is about to. */
export function pillLabel(spaces: readonly PillSpace[], activeId: string, pending: string | null): string {
  const here = `Project: ${nameOf(spaces, activeId)}`;
  return pending === null ? here : `${here}; ${PENDING_WORD} to ${nameOf(spaces, pending)}`;
}

export default function ProjectPill({ spaces, activeId, pending, onPick, onAll, compact = false }: ProjectPillProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = spaces.find((s) => s.id === activeId) ?? null;
  // The item the menu marks: where she will be once a held switch lands.
  const target = pending ?? activeId;

  // A press anywhere outside closes the menu; focus stays where the person put it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // Opening puts the focus on the item that is checked, so arrows start from where she is.
  useEffect(() => {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    (items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (id: string) => {
    onPick(id);
    close();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => items[(to + items.length) % items.length]?.focus();
    if (e.key === "Escape") {
      // Claimed: the stage rises on an unclaimed Escape, and her window folds on any it hears.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(items.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const label = pillLabel(spaces, activeId, pending);
  return (
    <div className={`project-pill${compact ? " project-pill--compact" : ""}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="project-pill__button focus-ring"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <ProjectDot hue={active ? active.hue : null} />
        <span className="project-pill__name">{active ? active.name : CORE_WORD}</span>
        {pending !== null && !compact ? <span className="project-pill__pending">{PENDING_WORD}</span> : null}
        <span className="project-pill__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div ref={menu} id={menuId} className="project-pill__menu" role="menu" aria-label="Switch project" onKeyDown={onMenuKey}>
          {pending !== null ? (
            <p className="project-pill__note" role="presentation">
              {`Now in ${nameOf(spaces, activeId)}; ${PENDING_WORD}.`}
            </p>
          ) : null}
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === target}
              tabIndex={-1}
              className="project-pill__item"
              onClick={() => pick(s.id)}
            >
              <ProjectDot hue={s.hue} />
              <span className="project-pill__item-name">{s.name}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={target === ""}
            tabIndex={-1}
            className="project-pill__item"
            onClick={() => pick("")}
          >
            <ProjectDot hue={null} />
            <span className="project-pill__item-name">Back to core</span>
          </button>
          {onAll ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="project-pill__item project-pill__item--all"
              onClick={() => {
                setOpen(false);
                onAll();
              }}
            >
              All projects
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
