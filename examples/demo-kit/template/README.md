# Template host app

A working skeleton of the shared scaffold from design 4.6: auth-less, SQLite seed, a list view, a
detail view, an activity log, read-only tools for the view and the selection, and one reversible
act (archive or reopen records, with Undo). It ships **without** Athena. Copy it, rename it, give it a domain.

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

## Adopt it

From the repository root, with `<app>` a new name for the next sibling under `examples/`:

```bash
node examples/demo-kit/adopt.ts <app> --port <N> --design <name> --dry-run   # the edits, nothing written
node examples/demo-kit/adopt.ts <app> --port <N> --design <name>             # optional: --title, --tagline
```

It refuses before writing anything, naming the prerequisite and the remedy, when the name is not a
package name, `examples/<app>` exists, a sibling's `package.json` dev script already holds the port
(it names the sibling and the first free port), the design cannot name a `[data-variant]` block, or
Node is older than 22.5. Otherwise it copies every file of this directory into a staging folder
beside the target, writes the identity - the package name and port, `APP_ID`, `APP_NAME`, `TAGLINE`
and `VARIANT` in `lib/constants.ts`, the `[data-variant]` block in `app/globals.css` - and renames
the folder into place only when every file landed. The instance's `.template.json` records this
template's digest and the answers: where the app came from, not a link back to it. The app's name
lives only in `lib/constants.ts`; `components/Shell.tsx` and `app/layout.tsx` read it from there.

Then the domain work, which no command can do for you:

1. `lib/constants.ts` - the `VIEWS` enum (every view your `navigate` tool can open). The SQLite
   file is named from `APP_ID`, so the database is already `examples/<app>/data/<app>.sqlite`.
2. `lib/types.ts` and `lib/db.ts` - replace `Record_` and the `records` table with your domain's
   tables and its deterministic seed. Keep `createActivityTable(db)` in the seed.
3. `components/Shell.tsx` - the nav.
4. `app/globals.css` - re-point the `--dk-*` hooks under your design's `[data-variant]` block so
   the shared toasts, activity log and badges follow your palette. One design, not three: every
   shipped app ships one and none mounts the switcher.
5. `components/HostCapabilities.tsx` - register **every** action from your section of design 4.6,
   with the right `reversible` and `sideEffects` flags.
6. `app/actions.ts` - one server action per mutating capability; each logs to `activity` and stores
   an `undo` payload whenever it is reversible.

Then, from the repository root (the command prints these too):

```bash
pnpm install
pnpm --filter <app> typecheck && pnpm --filter <app> lint && pnpm --filter <app> build
pnpm --filter <app> dev
```

and add `"dev:<app>": "pnpm --filter <app> dev"` to the root `package.json`; the command leaves
every shared file alone.

## What is already wired

| File | Does |
|---|---|
| `app/layout.tsx` | `ToastProvider` + `AppShell`, and mounts `HostCapabilities` above the pages |
| `app/providers.tsx` | the one client provider. No chat, no agent runtime |
| `components/HostCapabilities.tsx` | the `navigate` tool (enum of views, plus the `id` that `detail` needs) and the `read_current_view` tool, both on `document.modelContext` |
| `components/RecordsTable.tsx` | `DataTable` with row selection published as the `read_selection` tool |
| `components/Levels.tsx` | the three-depth read (L0 owners → L1 records → L2 one record) on the layered-UI formula: `useLevelFlight`, `presenceOf`, `sharedIdentity`/`useSharedIdentity`, `useOverlayEscape`, `useTokens` |
| `app/[id]/page.tsx` | detail view |
| `app/activity/page.tsx` | the shared activity log, with Undo bound to a server action |
| `app/actions.ts` | `setStatusAction` and `undoAction` - the server half of the act and of `undoActivity` |
| `lib/acts.ts`, `components/StatusAction.tsx` | the reversible act to copy: `planStatusChange` refuses a no-op or more than 50 ids, `setRecordStatus` (`lib/db.ts`) logs one row and returns `undoId`, the toast offers Undo, `applyUndo` restores only records no later act moved and names the rest, and `set_record_status` offers the same act to an agent as an AUTO tool |
| `../adopt.ts` (in the kit, not copied) | adopts this directory in one command: a readiness gate with named refusals, a dry-run preview, a staged copy renamed into place, the identity written into `package.json`, `lib/constants.ts` and `app/globals.css`, and `.template.json` stamping the template digest and the answers (ADR 0170) |

The agent seam is WebMCP: `useWebMCPTool` registers each capability on `document.modelContext`,
where any browser agent that speaks the standard - Athena through `packages/athena-bridge`
included - can read it. The app hosts no chat of its own. Each
registration carries the standard annotations, and a consumer applies the design 5.1 rule from
them: `consequentialHint` is GATED, `readOnlyHint` is AUTO, anything unknown is gated.

## The three levels

`components/Levels.tsx` is a skeleton of the layered-UI formula (`docs/layered-ui-formula.md`):
one surface read at three depths, where a level change is a move you can follow and abandon. It
is about a hundred lines and every one of them is a rule from §1, named in the file's header —
the outgoing level carries the camera, one claimant per shared id, one clock read out of the
cascade (`--dk-dur-*` in `app/globals.css`), the overlay owns its Escape and hands focus back,
presence comes from the model. It exists so a new app starts on the formula: round 1 had three
apps build the same five primitives, differently, before the kit grew them.

Give it your domain and your design, or delete it if your app is genuinely a flat list. What you
must not do is keep the shape and re-derive the primitives — that is the drift the kit's
`@athena/demo-kit/zoom` exports exist to prevent.

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
