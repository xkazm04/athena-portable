# Component catalog — the desktop shell

**Check this list before building any UI.** Import what is here (`@/components/<Name>`); do not
hand-roll a page frame, a table, a button, a badge, a status dot or an empty state. The house
style the first build settled on is the authority for *how* these are spent — tokens never
literals, the type ramp is the hierarchy, surfaces layer in three rungs, density is a variable —
and each file's header carries the argument for its own shape.

| Component | What it's for |
|---|---|
| `PageShell` | Every module's outer frame: one width (`120rem`), one gutter, one rhythm. `fill` for a module whose body is a viewport-height workspace. Never write a width or a gutter in a module. |
| `PageHeader` | The sticky title band — `eyebrow` · `title` (2–5 words, wraps, never elides) · `caption` (one sentence, ≤ 12 words) · `meta` · `action`. Renders outside every conditional. |
| `PageSection` | A titled band *inside* a page: heading, optional note, a hairline, content flush under it. Not a card. |
| `SectionCard` | The raised surface, for content that reads as one object. `posture`: `raised` (the chosen one) / `flat` / `absent` (the only dashed edge the app allows). |
| `Table` | The app's one table. A `columns` array with a `render` per column and a **required** `empty` sentence. Never a `<table>`, never a grid of divs. |
| `Button` | `primary` / `secondary` / `ghost`, two sizes, and `disabledReason` — a disabled control is never silent. |
| `Badge` | A small labelled pill. Its label is `--foreground` in every tone; the hue rides the `StatusDot` inside it. |
| `StatusDot` | The hue of a state, beside the word that says the same thing. A graphic needs 3:1, not 4.5:1. |
| `EmptyState` | "Nothing here yet": glyph, title, one line saying what would put something here, optional action. Not the same fact as "could not be read". |
| `ModuleBar` | The thin band that says which module the window is on. Pure: a list, a selection, a callback. Its height is a contract with `src-tauri/src/layout.rs`. |

## Adding one

1. **Two callers, or it stays in the module.** A primitive with one caller is a file move, not a
   promotion.
2. Give it a `@catalog <one line>` JSDoc tag and add a row above. The table is written by hand.
3. Keep it under ~200 lines, and keep `src/components/` free of store and IPC imports — a
   primitive that reads a store is a view.
