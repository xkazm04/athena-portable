/** The settings module's view. Pure. */

import { h } from "../../lib/dom.js";
import type { SettingsActions, SettingsModel } from "./model.js";

export function view(model: SettingsModel, actions: SettingsActions): HTMLElement {
  const engine = h("select", { class: "field", data: { role: "engine" } }) as HTMLSelectElement;
  for (const name of model.engines) {
    const option = h("option", { value: name }, name) as HTMLOptionElement;
    option.selected = name === model.engine;
    engine.append(option);
  }

  const modelField = field("model", model.model, "the engine's default");
  const brainField = field("brain", model.brainRoot, "ATHENA_HOME");
  const homeField = field("home", model.homeUrl, "https://");

  return h(
    "section",
    { class: "module module-settings", data: { module: "settings" } },
    row("Engine", engine, "Which CLI runs a turn. You are billed through your own subscription."),
    row("Model", modelField, "Leave empty for the engine's own default."),
    row("Brain", brainField, "A brain is a directory. Copy it to move it."),
    row("New tab", homeField, "Where a new page starts."),
    model.problems.length
      ? h("ul", { class: "problems", data: { role: "problems" } }, ...model.problems.map((p) => h("li", {}, p)))
      : null,
    h(
      "footer",
      { class: "settings-foot" },
      h(
        "button",
        {
          class: "save",
          disabled: model.saving,
          data: { role: "save" },
          on: {
            click: () =>
              actions.save({
                engine: engine.value,
                model: modelField.value,
                brainRoot: brainField.value,
                homeUrl: homeField.value,
              }),
          },
        },
        model.saving ? "saving…" : "save",
      ),
      model.savedAt ? h("span", { class: "saved-at" }, `saved ${model.savedAt}`) : null,
    ),
  );
}

function field(name: string, value: string, placeholder: string): HTMLInputElement {
  return h("input", { class: "field", type: "text", value, placeholder, data: { role: name } }) as HTMLInputElement;
}

function row(label: string, control: HTMLElement, help: string): HTMLElement {
  return h(
    "label",
    { class: "setting" },
    h("span", { class: "setting-label" }, label),
    control,
    h("span", { class: "setting-help" }, help),
  );
}
