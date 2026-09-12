/** The browser module's view: pure, a model in and an element out (`lib/module.ts`). */

import { classes, h } from "../../lib/dom.js";
import type { BrowserActions, BrowserModel, TabView } from "./model.js";

export function view(model: BrowserModel, actions: BrowserActions): HTMLElement {
  return h(
    "section",
    { class: "module module-browser", data: { module: "browser" } },
    addressBar(model, actions),
    model.error ? h("p", { class: "error", data: { role: "error" } }, model.error) : null,
    model.tabs.length
      ? h("ul", { class: "tabs", data: { role: "tabs" } }, ...model.tabs.map((tab) => row(tab, actions)))
      : empty(),
  );
}

function addressBar(model: BrowserModel, actions: BrowserActions): HTMLElement {
  const field = h("input", {
    class: "address",
    type: "url",
    value: model.address,
    placeholder: "https://",
    data: { role: "address" },
  }) as HTMLInputElement;

  const go = () => {
    const value = field.value.trim();
    if (value) actions.open(value);
  };

  field.addEventListener("keydown", (event) => {
    if ((event).key === "Enter") go();
  });

  return h(
    "div",
    { class: "address-bar" },
    field,
    h(
      "button",
      { class: "go", disabled: model.opening, data: { role: "open" }, on: { click: go } },
      model.opening ? "opening…" : "open",
    ),
  );
}

function row(tab: TabView, actions: BrowserActions): HTMLElement {
  return h(
    "li",
    {
      class: classes("tab", tab.active && "is-active"),
      data: { role: "tab", label: tab.label },
    },
    h(
      "button",
      { class: "tab-face", on: { click: () => actions.activate(tab.label) } },
      h("span", { class: "tab-title" }, tab.title || tab.url),
      h("span", { class: "tab-origin" }, origin(tab.url)),
      badge(tab),
    ),
    h(
      "button",
      {
        class: "tab-close",
        title: "close this tab",
        data: { role: "close" },
        on: { click: () => actions.close(tab.label) },
      },
      "×",
    ),
  );
}

/**
 * What the page offers, in three words.
 *
 * "no tools yet" and "registered nothing" are deliberately different sentences: the first is a page
 * that has not answered, the second is a page that answered with an empty list. Act 1 of the demo
 * shows one of each, and a panel that rendered them the same way would be hiding the distinction
 * the generic hands exist to cover.
 */
function badge(tab: TabView): HTMLElement {
  if (!tab.registered) return h("span", { class: "badge badge-quiet" }, "no tools yet");
  const word = tab.tools === 1 ? "tool" : "tools";
  return h(
    "span",
    { class: "badge", data: { role: "tools" } },
    tab.tools ? `${tab.tools} ${word}` : "registered nothing",
  );
}

function origin(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function empty(): HTMLElement {
  return h(
    "p",
    { class: "empty", data: { role: "empty" } },
    "No page is open. Athena works inside the applications you already use — open one.",
  );
}
