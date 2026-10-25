# 0221. The microphone's answer is read on arrival, followed, and a refusal says how to undo it

Date: 2026-10-25

Builds on the microphone ADR (`modules/voice/mic.ts`, the chosen input) and ADR 0192 (a lazy module
does not import `lib/voice` at run time). README section 3.1.

## Context

The Setup hook (`modules/setup/index.ts`) kept the microphone's answer as hook-local state seeded
`unknown` on every mount. A person who refused once was told "not asked yet" on the next visit,
and pressing Check again re-failed at once with the browser's raw words ("NotAllowedError:
Permission denied..."), because a remembered denial rejects `getUserMedia` without a prompt. The
platform already remembers the answer: `navigator.permissions.query({ name: "microphone" })` says
it without prompting, and its status fires `change` when the person changes it.

On Windows two answers can refuse the microphone: the system switch (Settings > Privacy & security
> Microphone, desktop apps allowed), and the answer the app's own prompt keeps for its origin.
WebView2 keeps that second refusal per origin, and turning the Windows switch on does not undo it.

## Decision

1. **Read, never ask.** `modules/setup/mic.ts` reads the permission state on mount (`granted` and
   `denied` are recalled; `prompt`, a missing API or a query that throws leave `unknown`) and
   follows its `change` event for the hook's life, so the row turns granted when the person turns
   the switch on while the Mind depth is open. Nothing is stored; the API is only read.
2. **A refusal is said as its way back.** `micRemedy(standing, platform)` turns `denied` into one
   plain sentence for the platform (read from the user agent). The Windows sentence names both
   paths: the system switch, and allowing it again at Athena's own microphone prompt. No sentence
   carries the machinery's words.
3. **The browser's words are kept, after the remedy.** `SetupModel.micRemedy` is the sentence;
   `micFact`'s denied summary reads it first. A refused press leaves `micDetail` as the remedy
   followed by the browser's own words in parentheses, which Mind's Microphone level draws
   verbatim.
4. **Off the first frame.** The hook is first-frame code (the console imports the depths' live
   hooks), so it reaches `mic.ts` only through `import()`; the first frame carries the effect and
   the two new model fields, about 125 B gzipped.

## Consequences

- The voice-io deviation recorded against `setup/index.ts` (a denial forgotten, no re-grant path)
  closes; `/conform` re-judges it.
- Where the Permissions API is missing the hook behaves as before: the standing stays `unknown`
  and Check the microphone reports as it did (a grant still carries the track's label).
- The microphone is still never required: readiness does not read it.
- The Windows prompt path is named, not driven: if WebView2 has kept the refusal so no prompt
  comes, clearing it needs a shell-side permission handler, which is out of this decision.
