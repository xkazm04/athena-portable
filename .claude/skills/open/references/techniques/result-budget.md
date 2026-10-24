# result-budget

**When** a tool answers, **fit 1,500 chars of JSON at realistic size, bound every list with "showing N
of M", page long documents with an outline and a next offset, trim or refuse in one guard rather than
let a cut land mid-JSON, and make every id unambiguous**, **because** Athena cuts each host tool result
at 1,600 chars (`RESULT_CAP`, `src/athena/lane/turn_frame.py:47`) and the producer never sees the cut.

## Rules

1. **The guard is 1,500**, 100 under her cap, so her "(showing N of M)" never fires inside the JSON.
   Every tool's answer passes through one bind guard (Shadowrunr `tool.ts` `guard`, `fitBody`).
2. **Lists are bounded** with small defaults and a ceiling in the schema: `{items, showing, total,
   footer: "showing N of M; more follow (raise limit or page on)"}`.
3. **The guard trims before it refuses.** An over-budget body loses list items, longest list first, and
   each trimmed list's footer says so ("trimmed from 50 to fit the result budget, ask for fewer or page
   on"). A list that pages by cursor **loses its `next_cursor`** when trimmed, because the cursor would
   skip the trimmed items, and the footer says to ask again with a smaller limit.
4. **A read that cannot fit is refused** `too_large: <tool>'s answer is N chars, over the 1500-char
   result budget; ask for less (a smaller limit, a later offset or a narrower id)`.
5. **A write that ran is never reported as failed.** Over budget, it answers `{done: true, footer: "...;
   read the result back with a read tool"}`.
6. **Documents come a page at a time**: `{doc, digest, total_chars, offset, text (at most 1,200, cut at a
   line end when one is near), next_offset?, outline?}`. The first page carries an `outline` (headings
   with their offsets, at most 20, dropped from the end before the first page's text falls under 600).
7. **Summaries give up detail before they drop their list**: clip long lines harder, keep the count.
8. **Echoes are clipped.** A write that echoes the agent's own 2,000-char note returns 300 chars of it and
   its length.
9. **A non-list answer of a generic router** that runs over comes back as `{truncated: true, text}`,
   the start of its JSON inside a string, so her cut never lands inside the structure.
10. **Ids are unique, or the error says how to qualify them.** A bare id that exists in two containers
    (a run id in two tournaments) must either be refused with the candidates or accepted only qualified.
11. **Errors are actionable**: `<code>: <message>`, the daemon's own code (`not_found`, `conflict`,
    `invalid_params`) or `refused`, plus what to call instead.
12. **Long work returns a handle.** A call has 30 s in the page (`inject.js:26`); work that takes longer
    starts, returns an id and a `next` hint, and is polled by a read.

## Checks

- **The size guard at realistic fixture size**: every tool, called with the inputs that make its answer
  largest (the biggest session, the longest transcript window, `limit` at its ceiling, every topic,
  every router method), answers in at most 1,500 (`apps/console/src/app/agent/size.test.ts` and
  `testkit.world.ts`). A test that every catalogue tool has a case, so a new tool cannot skip it.
- **The guard itself**: trims a list and says so; trims a nested list and drops its cursor; refuses a
  body with no list; reports an over-long write as done.
- Print the largest answer per tool, so drift is visible before it fails.

## Evidence

- Live pilot 2026-10-23 run 1, shape-malakor: no card; the 13.9k-char bible came back truncated and she
  asked the operator to paste it. Run 2, after paging (overlord `39d9d32`): the edit card was filed and
  approved, the package validated, a backup named. She paged the whole bible in 26 calls, so the
  follow-up is a find-in-doc or section read.
- Character audit 2026-10-24: a bare run id ambiguous across two tournaments cost a failed call; the
  error said how to qualify it and she recovered on the next call.

## Registry

`tool-result-economy` measures a result's cost end to end and asks that the way back be "reachable and
advertised"; `next_offset`, the outline and the footers are that way back (agrees). Its
`compressibility-follows-the-producer` keeps file contents exact at every size; under a hard 1,600 cap
exactness is kept across pages, with a digest and offsets, not in one result (stricter).
`mcp-tools/server-composition`: "timeouts and result-size caps are door policy", enforced uniformly
(agrees: one bind guard). `agent-browser-control/agent-actionable-errors` (agrees: rule 11).
