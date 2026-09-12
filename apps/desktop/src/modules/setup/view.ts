/** The setup module's view. Pure. */

import { h } from "../../lib/dom.js";
import type { CheckView, SetupActions, SetupModel } from "./model.js";

const GLYPHS: Record<string, string> = { healthy: "✓", broken: "✕", unknown: "?" };

export function view(model: SetupModel, actions: SetupActions): HTMLElement {
  return h(
    "section",
    { class: "module module-setup", data: { module: "setup" } },
    h(
      "p",
      { class: model.ready ? "ready" : "not-ready", data: { role: "summary" } },
      model.ready ? "Athena is ready." : model.summary,
    ),
    h("ul", { class: "checks", data: { role: "checks" } }, ...model.checks.map(check)),
    h(
      "footer",
      { class: "setup-foot" },
      h(
        "button",
        { class: "probe", disabled: model.probing, data: { role: "probe" }, on: { click: () => actions.probe() } },
        model.probing ? "checking…" : "check again",
      ),
      model.daemon ? h("span", { class: "daemon-address" }, model.daemon) : null,
    ),
    // The line that makes act 1 land: there is nowhere to type a key, because there is no key.
    h("p", { class: "note" }, "Athena runs turns through the CLI you are already signed in to. No API key is stored."),
  );
}

function check(item: CheckView): HTMLElement {
  return h(
    "li",
    { class: `check check-${item.state}`, data: { role: "check", name: item.name, state: item.state } },
    h("span", { class: "check-mark" }, GLYPHS[item.state] ?? "?"),
    h("span", { class: "check-name" }, item.name),
    h("span", { class: "check-detail" }, item.detail),
    item.state !== "healthy" && item.remediation
      ? h("p", { class: "check-fix", data: { role: "remediation" } }, item.remediation)
      : null,
  );
}
