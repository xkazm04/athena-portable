/**
 * The preview harness — README section 3.5, "no automation seam for the panel".
 *
 * Renders **any module, any fixture, either theme** in a plain browser:
 *
 * ```
 * pnpm --filter athena-desktop dev
 * http://127.0.0.1:1431/preview.html?module=browser&fixture=heavy&theme=light
 * ```
 *
 * No Tauri, no IPC, no daemon — that is the point, not a limitation. Only one shell can run at a
 * time (a WebView2 profile belongs to one process), so this is how a surface is checked against
 * every fixture in both themes while somebody else has the window. It is a deliverable of this
 * milestone rather than a wish, and it works for one reason: a view is a pure function of its
 * view-model and a fixture is a view-model with inert actions, so there is nothing here to stub.
 * If a view ever needs a stub, the view is wrong.
 *
 * `?chrome=0` removes this page's own bar, which is the shape a screenshot of a design should be
 * taken in.
 */
import { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import { MODULE_ENTRIES, moduleFor } from "@/modules/registry";
import { THEMES, applyTheme, isTheme, type Theme } from "@/stores/shell";

import "@/styles/app.css";

interface Query {
  module: string;
  fixture: string;
  theme: Theme;
  chrome: boolean;
}

/** Every field defaulted, so no parameter can blank the page. */
function readQuery(): Query {
  const q = new URLSearchParams(window.location.search);
  const theme = q.get("theme");
  return {
    module: moduleFor(q.get("module")).id,
    fixture: q.get("fixture") ?? "typical",
    theme: isTheme(theme) ? theme : "dark",
    chrome: q.get("chrome") !== "0",
  };
}

/** Rewrite the address bar, so a preview is always a link someone else can open. */
function writeQuery(next: Query): void {
  const q = new URLSearchParams({
    module: next.module,
    fixture: next.fixture,
    theme: next.theme,
    ...(next.chrome ? {} : { chrome: "0" }),
  });
  window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
}

function Preview() {
  const [query, setQuery] = useState<Query>(readQuery);

  useEffect(() => {
    applyTheme(query.theme);
    writeQuery(query);
  }, [query]);

  const set = useCallback(
    (patch: Partial<Query>) => setQuery((current) => ({ ...current, ...patch })),
    [],
  );

  const entry = moduleFor(query.module);
  const fixture = entry.fixtureIds.includes(query.fixture) ? query.fixture : entry.fixtureIds[0];

  return (
    <div className="harness">
      {query.chrome ? (
        <header className="harness__bar">
          <span className="typo-label muted">preview</span>
          <Picker
            label="module"
            value={entry.id}
            options={MODULE_ENTRIES.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(value) => set({ module: value, fixture: "typical" })}
          />
          <Picker
            label="fixture"
            value={fixture}
            options={entry.fixtureIds.map((id) => ({ value: id, label: id }))}
            onChange={(value) => set({ fixture: value })}
          />
          <Picker
            label="theme"
            value={query.theme}
            options={THEMES.map((t) => ({ value: t, label: t }))}
            onChange={(value) => set({ theme: isTheme(value) ? value : "dark" })}
          />
          <p className="typo-caption truncate" style={{ flex: "1 1 auto", minWidth: 0 }}>
            {entry.blurb}
          </p>
          <button
            type="button"
            className="btn btn--ghost btn--sm typo-label focus-ring"
            title="Hide this bar — the shape a screenshot should be taken in"
            onClick={() => set({ chrome: false })}
          >
            hide
          </button>
        </header>
      ) : null}
      {/* A definite height with one scroll, exactly as the window gives the module area, because
          `PageShell fill` resolves against a definite height: a harness that let the page grow
          instead would render a `fill` module short and nobody could tell that from a bug. */}
      <main className="harness__body">{entry.preview(fixture)}</main>
    </div>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="harness__field">
      <span className="typo-label muted">{label}</span>
      <select
        className="input typo-label focus-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// No `StrictMode` here, deliberately: the harness exists to look at a render, and a
// double-invoked render of a pure component is noise in a screenshot rather than a signal.
ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
