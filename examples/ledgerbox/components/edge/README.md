# The Strip — Ledgerbox's design

This directory is the whole user interface: shell, inbox, invoice stage, statement, reports,
activity, plus the primitives they share (`Money`, `useRun`, `aging`, `types`) and the design's
tokens (`edge.css`). `edge` is the short name the tokens are scoped under
(`[data-variant="edge"]`, set on the design's own wrapper div in `app/(shipped)/layout.tsx`, which
is why `edge.css` opens with `:root:has([data-variant="edge"])` — the attribute is not on `<html>`,
so the document behind the wrapper needs the same ground or overscroll shows white); it names this
design, not a choice between designs.

Route files under `app/` read the books and render a surface from here directly — no gate, no
switcher, no indirection. Everything above the design is shared with the rest of the repo: the data
layer (`lib/`, `app/actions.ts`), the capability registration each surface does for itself on
`document.modelContext` (`components/edge/StripTools.tsx` for this design), the app state readables
(`components/state/AppState.tsx`), and the kit's provider, toasts and `ActivityLog`.

The demo story the design must make obvious: **"Reconcile August and chase anything over 30 days."**
Matching with evidence, chasing with a tone, and the money gates (`mark_paid`, `send_reminder`,
`void_invoice`) are the point; everything else is furniture.

---

**Metaphor.** The quarter is a film strip you scrub. Every invoice is a card pinned to the day it
fell due; an overdue card drags a red tail from its due date to the "now" line at the right-hand
end, so lateness has *length*. Credits from the statement sit on a lower lane as coins on the day
they landed. Reconciliation on the detail stage is a coin physically settling onto the invoice.

**Type.** `Bricolage Grotesque` for everything, using its optical-size axis: display cuts at 64–120px
for the month and the running total, text cuts at 13–15px for cards. Tabular figures throughout.
It is the only `next/font` face the app loads.

**Palette (tokens).** `--e-ground #16123a` deep indigo · `--e-surface #221c5c` · `--e-raise #2f2778`
· `--e-ink #f3eefc` · `--e-mute #a79fd1` · `--e-late #ff6472` coral · `--e-owed #ffc76b` amber ·
`--e-ok #78f0c4` mint · `--e-gate #ff8a4c`. Depth comes from layered translucent surfaces and one
warm light source (top-left) expressed as inset highlights, not from grey shadows — over `#16123a`
a black blur is invisible, which is the constraint, not the taste. Components never carry a raw
colour, and the kit's `--dk-*` hooks are re-pointed at these tokens so the toasts, manifest drawer
and activity log land in the same palette without being restyled.

**Bounds.** Every consequential control is at least 44px tall (`.ed-btn`, `.ed-nav a`, `.ed-input`)
and no interactive control's text is below 13px — both enforced by rules at the bottom of
`edge.css` rather than left to discipline. `design/lb-scales.css` is the fuller type study and asks
for a 15px interactive floor; it is scoped to `[data-variant="scale"]`, which nothing mounts, so
that raise is still an open decision about `.ed-chip`, `.ed-select` and `.ed-btn[data-size="sm"]`.

**Motion vocabulary.** Springs only for things that move in space: `stiffness 380, damping 34`
(cards, coins), `stiffness 220, damping 28` (stage panels). Opacity fades at 180ms `easeOut`.
Layout animations via `layout` / `layoutId` when a coin moves from "offered" to "applied".
Reveal on load: cards fall into the strip staggered by day (40ms per day, capped). Scroll-linked:
`useScroll` on the strip container drives the month title and the running "owed by here" figure.
The vocabulary lives in `motion.ts`; `MotionConfig reducedMotion="user"` wraps the shell.

**Signature moment.** The **now-line**: as you scroll the strip, the huge total counts up through
the money that fell due before the point under your cursor, and the beam at "today" breathes. The
beam pulse is the only infinite animation and it stops under `prefers-reduced-motion`.

**Sacrificed on purpose.** Scanning density (a horizontal strip shows fewer rows than a table);
mobile ergonomics (it works at 390px but wants a trackpad); first-glance familiarity.
