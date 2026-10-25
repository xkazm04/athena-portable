# 0220. One tasks mirror per window: the runner hears the store, not a second bus and poll

Date: 2026-10-25

Extends ADR 0141 (fleet-surfaces: delegated tasks, her window runs them). Related: ADR 0217 (one
mirror reader for devices and sleep).

## Context

Her window held two mirrors of `GET /tasks`. The tasks store (`stores/tasks.ts`, the strip above
her composer and the row on Main) followed the bus, put each `task.changed` in place and read the
list on a reconnect at most once per 5 s, because a daemon with no bus refuses the stream at once
and `followBus` reconnects every second. The task runner (`stores/task-runner.ts`) followed the
same bus again with its own `followBus`, read the list on every (re)connect with no throttle, read
it again every 15 s on its own timer, and on start read it twice more (the orphan sweep, then the
first reread). Under a refusing daemon the runner read `GET /tasks` once a second beside a store
that had learned not to; a start read the list three times before the first claim.

## Decision

1. **The tasks store is the one mirror in a window.** The runner holds it like a surface does,
   through `startTasks(ear)`, and follows no bus, keeps no timer and issues no list read of its own.
   `RunnerDeps` loses `follow` and `every`; `TASK_POLL_MS` is gone. The list refreshes on the store's
   reconnect beat (the daemon ends a quiet stream every 15 s), bus or no bus.
2. **The ear hears what the store applied**: `ear(rows)` after each list read that answered (a 404 or
   a failed read is not a list and is not heard), `ear(null, row)` after each frame. One slot per
   window, not a listener list: her window has one runner, and the store sits in Main's first frame,
   where each byte is pinned by the first-paint ratchet.
3. **Every new holder has the list read for it**, or joins the read that is out, so the first list
   the runner hears was read after it began. That list sweeps the orphans (running rows no window
   runs, finished `failed` with ORPHANED); nothing is acted on - no frame, no later list, no claim -
   until the sweep settles. A frame heard before that first list is in it: the store reads once more
   when a frame lands during a read.
4. **Kill, claim and orphan semantics are unchanged**: a frame that is not `running` for a task the
   runner runs aborts it with no report; a list that no longer holds it does the same; a `queued`
   frame claims at once.
5. **The store does not adopt `lib/mirror.ts`** (ADR 0217) in this change. Its frames are rows put in
   place, not nudges to read, and the reader would add its whole body to Main's first frame, which
   has about 300 B of headroom; the store already has the reader's flight, read-once-more and
   reconnect beat. Folding it in is open for a change that pays for it in first-paint bytes.

## Consequences

- One bus stream and one throttled read path for tasks per window instead of two; the once-a-second
  read storm under a refusing daemon closes; a start reads `GET /tasks` once before the first claim.
- A change to how tasks are mirrored lands once, in `stores/tasks.ts`.
- If the first list read fails, the runner claims nothing until a read answers (the next reconnect
  read: within 5 s under a refusing bus, on the daemon's 15 s beat over a quiet one). Before, a bus
  frame could claim while the reads failed.
- Each new surface holding the store reads the list once on mount (joined when a read is out), not
  only the first holder: a surface that mounts later sees a list read after it came.
- First paint (Main) measured against HEAD alone: -3 B gzip (-1 B with build hashes normalized).
