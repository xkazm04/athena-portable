/**
 * The finder: go anywhere by name — README section 3.5, ADR 0087.
 *
 * Summoned by the console (Ctrl+K anywhere, "/" outside a field, or its control in the bar) and
 * fetched only then: this file, its corpus and its ranking are a lazy chunk, so the first frame
 * carries none of it. It reads the names the stores already hold (the apps, the shipped chores,
 * the accounts), builds the places with `places.ts` and ranks them on every keystroke. Enter makes
 * one move through the depth's own `go`, so the stage plays its normal dive and a place the
 * grammar refuses is never reached. Escape closes it and is kept from the stage, which would
 * otherwise rise a level as well.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { isValid, type Labeller, type Path } from "@/depth/model";
import { useBrowserModel } from "@/modules/browser";
import { itemOfTab } from "@/scenes/apps/model";
import { useConnectors } from "@/stores/connectors";
import { usePlaybooks } from "@/stores/playbooks";

import { placesOf, rank, type Place, type PlaceSources } from "./places";
import "./finder.css";

/** How many hits are shown; the rest are a few more letters away. */
const SHOWN = 8;

export interface FinderProps {
  go: (to: Path) => void;
  label?: Labeller;
  here: Path;
  recent: readonly Path[];
  onClose: () => void;
}

/** The names the stores hold, as the corpus's sources. */
function useSources(): PlaceSources {
  const browser = useBrowserModel();
  const playbooks = usePlaybooks((s) => s.items);
  const connectors = useConnectors((s) => s.items);
  useEffect(() => void usePlaybooks.getState().load().catch(() => {}), []);
  return useMemo(
    () => ({
      apps: [
        ...browser.apps.map((a) => ({ item: a.origin, label: a.host })),
        ...browser.tabs.map((t) => ({ item: itemOfTab(t), label: t.host || t.title })),
      ],
      chores: (playbooks ?? []).map((p) => ({ id: p.id, title: p.shortTitle })),
      accounts: connectors.map((c) => ({ id: c.id, label: c.label })),
    }),
    [browser.apps, browser.tabs, playbooks, connectors],
  );
}

export default function Finder({ go, label, here, recent, onClose }: FinderProps) {
  const sources = useSources();
  const places = useMemo(() => placesOf(sources, label), [sources, label]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hits = useMemo(() => rank(query, places, { recent, here }).slice(0, SHOWN), [query, places, recent, here]);
  const id = useId();
  const list = useRef<HTMLUListElement>(null);

  // Focus goes back where it was when the finder closes without a move; a move moves it itself.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected && document.activeElement === document.body) before.focus();
    };
  }, []);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const choose = (place: Place | undefined) => {
    if (!place || !isValid(place.path)) return;
    onClose();
    go(place.path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[active]);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + hits.length) % hits.length);
    }
  };

  return createPortal(
    <div className="finder" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="finder__panel" role="dialog" aria-modal="true" aria-label="Go to a place">
        <input
          className="finder__field focus-ring"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={hits[active] ? `${id}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Go to… an app, a chore, an account, a Mind place"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul ref={list} id={`${id}-list`} className="finder__list" role="listbox" aria-label="Places">
          {hits.map((p, i) => (
            <li
              key={p.crumb + i}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className="finder__hit"
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => choose(p)}
            >
              {p.trail.slice(0, -1).map((t, j) => (
                <span key={j} className="finder__up">
                  {t}
                  <span aria-hidden="true"> / </span>
                </span>
              ))}
              <b>{p.trail.at(-1)}</b>
            </li>
          ))}
        </ul>
        {hits.length === 0 && (
          <p className="finder__none" role="status">
            No place by that name.
          </p>
        )}
        <p className="finder__keys" aria-hidden="true">
          <kbd>Enter</kbd> go <kbd>↑</kbd>
          <kbd>↓</kbd> choose <kbd>Esc</kbd> close
        </p>
      </div>
    </div>,
    document.body,
  );
}
