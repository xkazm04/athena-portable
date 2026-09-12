# 0018. A surface offers only tightening overrides, and says why the rest are absent

Date: 2026-09-12

## Context

README section 3.3 ends with the sentence the whole trust model rests on: *"A surface may tighten
a class per origin but never loosen one below what the flags imply."* The gate enforces it — a
stored `AUTO` under a tool whose manifest declares `GATED` is ignored when the call is classified,
every time — so nothing the panel does can actually loosen anything.

That leaves the surface a choice the daemon does not care about. The per-tool class control could
offer all three classes and let the gate refuse the ones that loosen, or it could offer only the
ones that will be honoured. The first is simpler to write and produces a control whose every press
in one direction is silently undone somewhere the user cannot see. The first build shipped the
equivalent of it — a "reset" that was one of three possible acts — and its own notes record the
user asking what the other two were.

There is a second case the choice has to survive. Classes arrive with a live manifest, so an
origin whose page is not open right now has stored rulings and no declared classes at all. There
is nothing to tighten *from*.

## Decision

`src/lib/classes.ts` owns the tightening order — `AUTO`, `READ`, `GATED`, loosest first — and two
functions: `allowedOverrides(declared)`, which is always a suffix of that order and is empty for a
tool that is already `GATED`, and `whyNoOverride(declared)`, which is the sentence the surface
prints where the options would have been.

Both the Panel's tool rail and the Origins detail spend those two functions through the one shared
control, `@/components/ClassPill`'s `ClassPicker`. A class a user cannot pin is not rendered
disabled and it is not rendered at all; what is rendered instead is the reason, in the app's own
words, on the page — house style's rule that a control the user cannot use is never silent.

A tool whose declared class is unknown offers nothing and says that is why, and its stored ruling
can be cleared but not changed. `effectiveClass` returns the declared class whenever the stored
ruling does not tighten it, and `overrideIgnored` lets the detail say so out loud, so a ruling the
page's own manifest has since overtaken is visible rather than merely inert.

This file decides no class. It reads one the gate already derived and answers a narrower question:
which *other* class may a person pin this at. The gate remains the only thing that classifies a
call (README invariant 3).

## Consequences

- The two surfaces cannot disagree about what may be tightened, and neither can drift from the
  gate: there is one order, written once.
- A user never presses a control whose effect is discarded, and never finds an option missing with
  no explanation.
- The tightening order is now a thing the daemon and the panel both believe. If the daemon ever
  reorders the classes, `CLASS_ORDER` and its test are where the panel is corrected, and the test
  named "no allowed override ever loosens the declared class" is what fails first.
- A ruling on a tool whose page is not open is preserved and shown, not hidden. That is more rows
  in the detail than a live-manifest-only list would have, and it is the set the page exists to
  let a user undo.
