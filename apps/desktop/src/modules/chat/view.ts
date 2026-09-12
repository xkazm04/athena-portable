/**
 * The chat module's view (README §5 phase P5: "decision card + tool list").
 *
 * Pure, like every view here. The one thing worth defending is the order: cards come *above* the
 * transcript, not inside it. A card is the only thing on this surface that is waiting on the user,
 * and a card that scrolled away with the conversation is a card that gets answered late or not at
 * all — which in this system means a turn that silently did nothing.
 */

import type { ToolRow } from "../../lib/client.js";
import type { DecisionRequested, TurnSummary } from "../../lib/events.js";
import { classes, h } from "../../lib/dom.js";
import type { TranscriptEntry } from "../../stores/run.js";
import type { ChatActions, ChatModel } from "./model.js";

export function view(model: ChatModel, actions: ChatActions): HTMLElement {
  return h(
    "section",
    { class: "module module-chat", data: { module: "chat" } },
    model.cards.length
      ? h("div", { class: "cards", data: { role: "cards" } }, ...model.cards.map((card) => cardView(card, actions)))
      : null,
    transcript(model),
    model.error ? failure(model.error) : null,
    model.summary ? summary(model.summary) : null,
    composer(model, actions),
    toolList(model.tools),
  );
}

// --- the card ------------------------------------------------------------------------------------

/**
 * One decision, with the parameters the approval was actually filed for.
 *
 * The parameters are not a detail to be folded away. The gate replays with the row's own
 * parameters (README §3.2 step 6), so what is printed here is exactly what will run — and
 * approving "send a chase" without seeing which invoice is not consent to anything.
 */
function cardView(card: DecisionRequested, actions: ChatActions): HTMLElement {
  return h(
    "article",
    { class: "card", data: { role: "card", id: card.id } },
    h(
      "header",
      { class: "card-head" },
      h("span", { class: "card-action", data: { role: "action" } }, card.action),
      h("span", { class: "card-origin" }, card.origin),
    ),
    card.rationale ? h("p", { class: "card-why" }, card.rationale) : null,
    parameters(card.params),
    h(
      "footer",
      { class: "card-answers" },
      ...card.options.map((option) =>
        h(
          "button",
          {
            class: classes("answer", option.id === "approve" && "answer-approve"),
            data: { role: "answer", choice: option.id },
            on: { click: () => actions.answer(card.id, option.id) },
          },
          option.label || option.id,
        ),
      ),
    ),
  );
}

function parameters(params: Record<string, unknown>): HTMLElement {
  const entries = Object.entries(params);
  if (!entries.length) {
    return h("p", { class: "card-params card-params-empty" }, "no parameters");
  }
  return h(
    "dl",
    { class: "card-params", data: { role: "params" } },
    ...entries.flatMap(([key, value]) => [
      h("dt", {}, key),
      h("dd", {}, typeof value === "string" ? value : JSON.stringify(value)),
    ]),
  );
}

// --- the transcript ------------------------------------------------------------------------------

function transcript(model: ChatModel): HTMLElement {
  if (!model.transcript.length) {
    return h(
      "p",
      { class: "empty", data: { role: "empty" } },
      model.appId
        ? `Ask about ${model.appId}, or about anything you have open.`
        : "Open a page and Athena will work inside it.",
    );
  }
  return h(
    "ol",
    { class: "transcript", data: { role: "transcript" } },
    ...model.transcript.map(entry),
    model.phase === "running" || model.phase === "acting"
      ? h("li", { class: "entry entry-working", data: { role: "working" } }, working(model.phase))
      : null,
  );
}

function working(phase: string): string {
  return phase === "acting" ? "acting on the page…" : "thinking…";
}

function entry(item: TranscriptEntry): HTMLElement {
  return h(
    "li",
    {
      class: classes("entry", `entry-${item.kind}`, item.ok === false && "entry-failed"),
      data: { role: "entry", kind: item.kind },
    },
    item.tier !== undefined ? h("span", { class: "tier" }, `tier ${item.tier}`) : null,
    h("p", { class: "entry-text" }, item.text),
  );
}

// --- the footers ---------------------------------------------------------------------------------

function failure(error: { reason: string; detail: string }): HTMLElement {
  return h(
    "p",
    { class: "error", data: { role: "error", reason: error.reason } },
    `${error.reason}: ${error.detail}`,
  );
}

/** What the turn cost, from the ledger row it wrote (README §2 invariant 6). */
function summary(row: TurnSummary): HTMLElement {
  const cost =
    row.cost_usd === null
      ? "cost not reported"
      : `$${row.cost_usd.toFixed(4)}${row.cost_estimated ? " (estimated)" : ""}`;
  const rounds = row.rounds === 1 ? "1 round" : `${row.rounds} rounds`;
  return h(
    "p",
    { class: "summary", data: { role: "summary" } },
    `${row.model || row.engine} · ${rounds} · ${row.input_tokens + row.output_tokens} tokens · ${cost}`,
  );
}

function composer(model: ChatModel, actions: ChatActions): HTMLElement {
  const busy = model.phase === "running" || model.phase === "acting";
  const field = h("textarea", {
    class: "composer-field",
    placeholder: model.ready ? "Ask Athena" : "Athena is not ready yet",
    disabled: !model.ready,
    data: { role: "composer" },
  }) as HTMLTextAreaElement;

  const send = () => {
    const text = field.value.trim();
    if (!text || busy) return;
    field.value = "";
    actions.send(text);
  };

  field.addEventListener("keydown", (event) => {
    const key = event;
    if (key.key === "Enter" && !key.shiftKey) {
      key.preventDefault();
      send();
    }
  });

  return h(
    "form",
    { class: "composer", on: { submit: (event) => event.preventDefault() } },
    field,
    busy
      ? h("button", { class: "cancel", data: { role: "cancel" }, on: { click: () => actions.cancel() } }, "stop")
      : h(
          "button",
          { class: "send", disabled: !model.ready, data: { role: "send" }, on: { click: send } },
          "send",
        ),
  );
}

// --- the tool list -------------------------------------------------------------------------------

/**
 * Every name this application offers, with the class the catalog gave it.
 *
 * Act 1 of the demo is this list. The class is printed rather than implied by an icon, because
 * `GATED` is a promise to the user about what cannot happen without them and a promise worth
 * making is worth spelling.
 */
function toolList(tools: ToolRow[]): HTMLElement {
  if (!tools.length) {
    return h(
      "details",
      { class: "tools" },
      h("summary", {}, "Tools"),
      h("p", { class: "empty" }, "This page has not registered any tools."),
    );
  }
  return h(
    "details",
    { class: "tools", data: { role: "tools" } },
    h("summary", {}, `Tools (${tools.length})`),
    h(
      "ul",
      { class: "tool-list" },
      ...tools.map((tool) =>
        h(
          "li",
          { class: "tool", data: { role: "tool", name: tool.name } },
          h("span", { class: `tool-class tool-${tool.class.toLowerCase()}` }, tool.class),
          h("span", { class: "tool-name" }, tool.name),
          h("span", { class: "tool-tier" }, `tier ${tool.tier}`),
          tool.description ? h("span", { class: "tool-why" }, tool.description) : null,
        ),
      ),
    ),
  );
}
