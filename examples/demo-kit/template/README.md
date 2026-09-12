# Template host app

A working skeleton of the shared scaffold from design 4.6: auth-less, SQLite seed, a list view, a
detail view, an activity log, and one registered action plus one readable. It ships **without**
Athena. Copy it, rename it, give it a domain.

This directory is deliberately **not** a workspace package (`pnpm-workspace.yaml` matches
`examples/*`, and this lives one level deeper), so `pnpm install` ignores it until you copy it out.

That is also why nothing in the workspace's own `typecheck`, `lint` or `build` reaches it — all
three filter `./examples/*`. `scripts/check-template.mjs` is what closes that hole: it copies this
directory to `examples/_smoke`, borrows an already-installed example app's `node_modules` (it
installs nothing and writes no lockfile), runs this template's own `tsc --noEmit`, and removes the
copy. Run it after any change to the kit or to this scaffold:

```bash
node scripts/check-template.mjs
```

## Copy and rename

From the repository root, with `<app>` a new name alongside the four that exist - `ledgerbox`,
`hirelane`, `tidycrm`, `clonedeck`:

```bash
cp -r examples/demo-kit/template examples/<app>          # Windows: robocopy /E, or use git bash
```

Then edit, in this order:

1. `package.json` - `"name": "<app>"`.
2. `lib/constants.ts` - `APP_ID = "<app>"`, `VARIANT` (the name of your design), and the `VIEWS`
   enum (every view your `navigate` tool can open). The SQLite file is named from `APP_ID`, so this
   one change moves the database to `examples/<app>/data/<app>.sqlite`.
3. `lib/types.ts` and `lib/db.ts` - replace `Record_` and the `records` table with your domain's
   tables and its deterministic seed. Keep `createActivityTable(db)` in the seed.
4. `app/layout.tsx`, `components/Shell.tsx` - app name, tagline, nav.
5. `app/globals.css` - give the design a name, set `VARIANT` to it, and re-point the `--dk-*` hooks
   under `[data-variant="<name>"]` so the shared toasts, activity log and badges follow your
   palette. One design, not three: every shipped app ships one and none mounts the switcher.
6. `components/HostCapabilities.tsx` - register **every** action from your section of design 4.6,
   with the right `reversible` and `sideEffects` flags.
7. `app/actions.ts` - one server action per mutating capability; each logs to `activity` and stores
   an `undo` payload whenever it is reversible.

Then, from the repository root:

```bash
pnpm install
pnpm --filter <app> typecheck && pnpm --filter <app> lint && pnpm --filter <app> build
pnpm --filter <app> dev
```

Add `"dev:<app>": "pnpm --filter <app> dev"` to the root `package.json` if it is not there already,
and give each app a distinct port in its own `package.json` (`next dev --port 300x`) so all four can
run at once.

## What is already wired

| File | Does |
|---|---|
| `app/layout.tsx` | `ToastProvider` + `AppShell`, and mounts `HostCapabilities` above the pages |
| `app/providers.tsx` | the one client provider. No chat, no agent runtime |
| `components/HostCapabilities.tsx` | the `navigate` tool (enum of views, plus the `id` that `detail` needs) and the `read_current_view` tool, both on `document.modelContext` |
| `components/RecordsTable.tsx` | `DataTable` with row selection published as the `read_selection` tool |
| `app/[id]/page.tsx` | detail view |
| `app/activity/page.tsx` | the shared activity log, with Undo bound to a server action |
| `app/actions.ts` | `undoAction` - the app-specific half of `undoActivity` |

The agent seam is WebMCP: `useWebMCPTool` registers each capability on `document.modelContext`,
where any browser agent that speaks the standard - Athena through `packages/athena-bridge`
included - can read it. The app hosts no chat of its own. Each
registration carries the standard annotations, and a consumer applies the design 5.1 rule from
them: `consequentialHint` is GATED, `readOnlyHint` is AUTO, anything unknown is gated.

## Rules the app agents must not break

- **No API keys, no network at runtime, no telemetry.** Nothing in the app calls a model.
- **`node:sqlite` only.** No `better-sqlite3`, no native modules. Node >= 22.5.
- **Every mutating action logs to `activity`**, and stores an `undo` payload when it is reversible.
- **`reversible` and `sideEffects` are the contract**, not decoration: `reversible && sideEffects
  !== "external"` is what makes a tool AUTO. Anything that reaches a person, a payment or a public
  URL is `sideEffects: "external"` and therefore GATED.
- **Enums and `maxItems` are mandatory** on any parameter that addresses UI (design 5.1).
- **A handler must reach every member of its own enum**, and must report a refusal as a refusal.
  An enum member the handler quietly redirects — `navigate({ view: "detail" })` landing on the list
  and answering `Opened detail.` — is worse than no enum at all: the agent's next step acts on the
  wrong page, and the `read_current_view` tool then contradicts the answer it was just given. Drop
  the member, or take the parameter it needs and return `{ ok: false, error }` when it is absent.
- Server-only modules (`lib/db.ts`, `@athena/demo-kit/db`, `@athena/demo-kit/activity`) must never
  be imported from a `"use client"` file. Share row types through `lib/types.ts` instead.
