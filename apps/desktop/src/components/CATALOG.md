# Component catalog — the desktop shell

**Check this list before building any UI.** Import what is here (`@/components/<Name>`); do not
hand-roll a page frame, a table, a button, a badge, a status dot or an empty state. The house
style the first build settled on is the authority for *how* these are spent — tokens never
literals, the type ramp is the hierarchy, surfaces layer in three rungs, density is a variable —
and each file's header carries the argument for its own shape.

| Component | What it's for |
|---|---|
| `Table` | The app's one table. A `columns` array with a `render` per column and a **required** `empty` sentence. Never a `<table>`, never a grid of divs. |
| `Button` | `primary` / `secondary` / `ghost`, two sizes, and `disabledReason` — a disabled control is never silent. |
| `PillGroup` | The one value picker on a rail: a `radiogroup` with one tab stop and arrow keys. A rail that sets a *setting*, not one that switches a view. |
| `FormField` | A labelled field — label, hint **or** error, `aria-invalid` and `aria-describedby` wired by the wrapper. `TextInput` is the input it wraps; `action` seats a button level with the control. |
| `Facts` | A term and its value, a few at a time — the `<dl>` a surface would otherwise hand-roll. `value="code"` for a machine's own spelling. |
| `WindowControls` | The title bar's right end: the theme flip and the minimise, maximise and close buttons, the close asking first when a decision waits. Used by the module bar and the depth stage. |
| `ProblemNote` | A surface that could not be read, with the reason verbatim. Never the same component as `EmptyState`: "nothing here" and "could not be read" are different facts. |
| `Badge` | A small labelled pill. Its label is `--foreground` in every tone; the hue rides the `StatusDot` inside it. |
| `StatusDot` | The hue of a state, beside the word that says the same thing. A graphic needs 3:1, not 4.5:1. |
| `EmptyState` | "Nothing here yet": glyph, title, one line saying what would put something here, optional action. Not the same fact as "could not be read". |

## Adding one

1. **Two callers, or it stays in the module.** A primitive with one caller is a file move, not a
   promotion.
2. Give it a `@catalog <one line>` JSDoc tag and add a row above. The table is written by hand.
3. Keep it under ~200 lines, and keep `src/components/` free of store and IPC imports — a
   primitive that reads a store is a view.
