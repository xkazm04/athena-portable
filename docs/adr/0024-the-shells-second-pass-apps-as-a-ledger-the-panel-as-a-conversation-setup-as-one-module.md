# 0024. The shell's second pass: apps as a ledger, the panel as a conversation, setup as one module

Date: 2026-09-12

## Status

Accepted. Reshapes the three modules of ADR 0013's module-first window (the Browser, the Panel,
Setup and Settings) without changing the module contract or a store.

## Context

The first pass of each module was the smallest surface that proved its seam: the Browser proved
the relay, the Panel proved the run loop, Setup and Settings proved the store. Once the demo was
rehearsed on them, three things showed. The Browser was a tab list, and a person who opens the
window to nothing had no way in but a `+`. The Panel read as a log — a card above a transcript
above a composer above a tool table — when the thing a person does on it is talk. And Setup and
Settings were two modules about the same four facts, one asking and one editing, so a returning
user had to learn where a fact lived twice.

## Decision

**The Browser is about apps, and its ledger is the origins table.** Below the unchanged tab
strip — its first 40 px are a layout contract — the module shows, when nothing is open, a doorway:
a drawing of the window itself in token strokes and one address field at title size. Under it,
always, a ledger of registered apps read from the origins store, one row per origin the user has
trusted, with a *standing* derived at render from the tabs and the relay (not opened, reading, N
tools over a transport, no bridge so the hands operate it, switched off) and never stored.
Registering an app is one act in two steps in the right order: trust the origin, then open it, so
Athena reads a page she is already allowed to act on. The strip's pill and the ledger's word are
the same fact.

**The Panel is a conversation.** One column of 46rem, the user's lines as recessed bubbles on the
right, Athena's prose plain on the left behind a small mark, consecutive deltas grouped into one
message *in the model* so the view never reconciles a stream. Tool activity folds to a row of
chips with the full lines behind a toggle, because the audience wants to see that something ran
and only sometimes what came back. Pending cards are the last blocks of the stream — where the eye
already is — as a raised card with a left rule in the warning hue, and the tool table becomes a
disclosure in the header. The composer is the one bordered, rounded object on the surface. An
empty panel asks what Athena should do on this host and offers the page's own read tools as
suggestions. Voice rides the same surface: the partial transcript shows in the composer while the
key is held, and a card filed from a spoken turn says it can be answered by voice.

**Setup is one module with two modes of one view-model.** `onboarded` selects the mode and is
stored; the mode itself is derived and never is. Onboarding is a 40rem letter with the two things
a first turn needs (an engine that answered, a page that is open), the microphone as an optional
aside, and one primary button that is quiet until the machine is ready and carries the reason
when it is not. After onboarding the same module is the settings page: a list of rows with
hairlines, the fact on the left and its control on the right, for the engine (with the restart
notice when a ready daemon runs on another engine than the stored row, and the restart wired to
the daemon store), the page, the theme, the brain directory, the microphone, the voice channel and
the data location. Readiness keeps its semantics and loses its numbered stations: nothing on
either surface is a sequence.

**Every module keeps its own stylesheet.** `browser.css`, `panel.css` and `setup.css` sit beside
their views and use tokens only; `app.css` keeps the contract, the catalog's components and the
chrome. The three modules were built by three people at once and the file they would have fought
over was the one stylesheet.

**The bar carries the app's mark.** The same icon the window and the taskbar show, at the head of
the module bar, so the bar names the app the way the operating system does.

## Consequences

- The Browser's view-model gains `apps`, `appsProblem` and the register/open/enable/forget
  actions; `selectBrowser` takes an origins snapshot as an optional fifth argument so the earlier
  callers and tests stand.
- The Panel's view-model gains `messages`, `host`, `suggestions` and `voice`; `groupMessages` and
  `suggestionsFor` are pure and tested.
- The `settings` module directory is gone and the registry lists browser, panel, setup. The theme
  shortcut in the bar still writes the same row.
- The old `.transcript`, `.composer`, `.panel-card`, `.passage` and `.rail` blocks are removed from
  `app.css`; `.page-stand-in` stays because the Browser still uses it under an open tab.
- The preview harness renders every fixture of every module in both themes; the screenshots of
  this pass were taken from it and not from the window.
