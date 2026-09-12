/**
 * `preview.html?module=<id>&fixture=<name>` — every module, every state, without Tauri.
 *
 * README §3.5 names this as the thing the first build did not have: "no automation seam for the
 * panel". A module that can only be seen by launching the shell, starting a daemon, opening a page
 * and driving it into the right state is a module nobody looks at, and its empty and failing states
 * are the ones nobody ever sees at all.
 *
 * So: no Tauri, no daemon, no network. A fixture is data and a view is pure, so rendering one is a
 * function call. The index lists every module and every fixture, which makes it a contact sheet of
 * the whole panel — and a missing fixture is visible rather than merely absent.
 */

import { h, replace } from "./lib/dom.js";
import { inertActions, moduleById } from "./lib/module.js";
import { REGISTRY } from "./modules/index.js";

export function render(root: HTMLElement, search: string): void {
  const params = new URLSearchParams(search);
  const moduleId = params.get("module");
  const fixture = params.get("fixture");

  if (!moduleId) {
    replace(root, index());
    return;
  }

  let found;
  try {
    found = moduleById(REGISTRY, moduleId);
  } catch (error) {
    replace(root, problem(error instanceof Error ? error.message : String(error)));
    return;
  }

  const names = Object.keys(found.fixtures);
  const chosen = fixture && fixture in found.fixtures ? fixture : names[0];
  if (!chosen) {
    replace(root, problem(`${found.id} declares no fixtures`));
    return;
  }

  replace(
    root,
    h(
      "div",
      { class: "preview" },
      h(
        "header",
        { class: "preview-head" },
        h("a", { href: "preview.html", class: "preview-home" }, "all modules"),
        h("strong", {}, found.title),
        h(
          "nav",
          { class: "preview-fixtures" },
          ...names.map((name) =>
            h(
              "a",
              {
                class: name === chosen ? "is-active" : "",
                href: `preview.html?module=${found.id}&fixture=${encodeURIComponent(name)}`,
              },
              name,
            ),
          ),
        ),
      ),
      // The 380 px frame is part of what is being previewed: a module that only looks right wider
      // than the column it lives in is a module that does not fit.
      h(
        "div",
        { class: "preview-column", data: { role: "preview-column" } },
        found.view(found.fixtures[chosen] as never, inertActions()),
      ),
    ),
  );
}

function index(): HTMLElement {
  return h(
    "div",
    { class: "preview preview-index" },
    h("h1", {}, "Panel modules"),
    ...REGISTRY.map((module) =>
      h(
        "section",
        { class: "preview-entry" },
        h("h2", {}, `${module.glyph} ${module.title}`),
        h(
          "ul",
          {},
          ...Object.keys(module.fixtures).map((name) =>
            h(
              "li",
              {},
              h(
                "a",
                { href: `preview.html?module=${module.id}&fixture=${encodeURIComponent(name)}` },
                name,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function problem(message: string): HTMLElement {
  return h("p", { class: "error" }, message);
}

if (typeof document !== "undefined") {
  const root = document.getElementById("preview");
  if (root) render(root, location.search);
}
