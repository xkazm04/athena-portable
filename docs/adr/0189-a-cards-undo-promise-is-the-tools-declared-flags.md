# 0189. A card's undo promise is the tool's declared flags, not its verb

Date: 2026-10-25

## Context

The slip's first sentence (README section 3.1, ADR 0026) is the line a person signs against: what
will happen, and whether it can be taken back. `describeDecision` chose that promise from the
English verb in the tool's name: a hand-list of sending verbs read "cannot be taken back", a
hand-list of destroying verbs read "cannot be undone", and every other verb read "is changed in
<app>." with no warning.

The gate classifies the same tool from what the app declared (README section 3.3,
`HostTool.default_class`): `reversible` and `side_effects`, which every host and connector tool
carries. The two disagreed. Six gated tools in the shipped apps and connectors are declared
irreversible or external while their verb reads mild (ledgerbox `mark_paid`, hirelane
`decide_stage`, tidycrm `merge_contacts` and `undo`, Notion `append_to_page` and `create_page`),
so their card promised less than the contract the gate enforces. The other way round, any
reversible tool named archive, close or cancel was told it "cannot be undone". `toolRows` computed
the class from the flags and then dropped them, so the words had nothing else to read.

## Decision

1. **The declaration is the authority; the verb is only the wording.** `describeDecision` takes
   an optional `flags: {reversible, side_effects}`. Risk is derived from them: external is
   `outbound`, irreversible is `destructive`, reversible with no side effects is `read`, other
   reversible is `change`. The sending-verb list survives only to choose the sentence's shape
   ("<who> will receive ..." versus "<it> goes out to <app> ..."); the destroying-verb list is
   gone.
2. **Undeclared fails loud.** Missing flags, or a `null` reversibility, take the severe bucket
   (`outbound` for a sending verb, else `destructive`) and the sentence says why: "The app did not
   declare whether this can be undone, so the card assumes it cannot." `DecisionWords.declared`
   is false (hitl-approval, fail-loud classification default: an unreadable classification must
   not share a spelling with a mild one).
3. **The flags ride beside the class.** `ToolRow` gains optional `reversible` and `side_effects`;
   `toolRows` keeps `flagsOf`'s answer on the row, except the gate's fallback for a tool that
   declared nothing (`basis: "unknown"`), which is the gate's caution and not the app's word.
   `cardView` looks the card's flags up in the page rows, or for a connector card in the
   connectors mirror, and passes them through.
4. **The gate is untouched.** The class shown and sent is still the gate's: a first-sight origin,
   a pinned tool or a drifted contract still makes a row `GATED` whatever the flags say; only the
   words read the declaration.

## Consequences

- The sentence a person signs against can no longer understate a declared consequence; it can
  only overstate when the app declined to declare, and then it says that is why.
- A surface that builds cards without tool rows (a preview fixture, a card whose page went away)
  now reads every card as undeclared and adds the sentence. That is the honest reading of what it
  holds.
- No stored data, protocol or gate change; the new `ToolRow` fields are optional, so a daemon or
  source that does not carry them reads as undeclared. Reverting restores the verb-only wording.
