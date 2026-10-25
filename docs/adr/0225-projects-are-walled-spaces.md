# 0225. Projects are walled spaces

Date: 2026-10-25

Builds on [0003](0003-disk-is-truth-one-writer-many-readers.md) (disk is truth, the index is derived),
[0006](0006-two-output-prompt-composer.md) (static blocks and the turn frame),
[0080](0080-a-memory-file-is-written-whole-or-not-at-all.md) (whole-file writes),
[0123](0123-an-approved-brief-is-a-case-file-in-the-brain.md) (a chore's case file and its `proj_` id),
[0127](0127-a-cases-turns-keep-their-conversations-and-are-stamped-under-it.md) (a turn stamped
under its case) and [0143](0143-each-pc-knows-its-room-and-sleeps-on-what-it-wrote.md) (the sleep
cycle). README sections 2, 3.2 and 3.5. Registry: `agent-memory` /
`scope-before-similarity` (a store that holds several projects scopes before it compares).

## Context

**Memory mixes.** Athena has one brain and one recall. A person who uses her for their taxes, a
garden and a job hunt gets all three back in every turn: the keyword lane matches a tax fact on a
garden question, the always tier carries the job hunt's procedurals into the tax turn, and a sleep
pass that reads a window of episodes distils one belief from several unrelated pieces of work.
Nothing in the tree says which work a memory belongs to, so nothing can keep them apart, and a
person has no way to put one piece of work away - or to erase it - without erasing everything.

**Apps are the wrong parent.** The desktop's top level is Apps: one orb per registered web app. A
person's work crosses apps (a tax return reads the bank, the payroll firm and the tax portal), and
one app serves several pieces of work, so an app cannot be the thing a memory or a brief belongs to.

**The word "project" is taken.** `proj_` is already a chore's case (`contracts/ids.py`, ADR 0123):
`project_id` on `POST /run`, `TurnContext.project_id`, `conversation_for_project`, the desktop's
`active_project` and the prompt's `frame.project` all mean "the case whose chore this turn runs".
Reusing the word for the person's new parent layer would give `project_id` two meanings on one
wire, which is how a turn ends up in the wrong conversation (the `conv_proj_proj_` lesson of README
section 3.5).

## Decision

**Vocabulary.** The person's word is **Project**; the code's and the wire's is **space**. Nothing
named `proj_`, `project_id`, `active_project` or `frame.project` changes or gains a second meaning.
**Core** is no space: everything outside every space, including every memory that existed before
spaces did, visible everywhere. Its one spelling is the empty string `""` - the index column, the
wire's `space_id`, the desktop's `activeId` - never `null`; frontmatter omits the `space` key for
core. `core` (`CORE_ITEM`) is only a path segment, where an empty one cannot be written.

**Ids.** `ID_PREFIXES` gains `"space": "spc_"`, twelve hex digits, minted. No prefix is a prefix of
another, so a `spc_` id is never read as a case's `proj_` id or the other way round.

**The space file** is `<brain>/spaces/<spc_id>.md`: `# <name>`, the brief, then one JSON block
after the last `<!-- athena:space -->` marker, the case file's pattern (ADR 0123):
`{"schema": 1, "id", "name", "brief", "apps", "hue", "created", "updated"}`. The block is the truth;
a key this build does not own is carried forward by every rewrite. The file is written whole or not
at all (ADR 0080). `spaces/` is not in the rebuild's walk: a space is not a memory and has no index
row. Caps are refused, never cut, as 400 `bad_request` naming the cap: name 1 to 60 characters
after whitespace is folded; brief at most 1,600; apps at most 24 distinct origins, each normalised
to `scheme://host[:port]` (http or https, lower-cased, default port dropped; a path, query or user
part is refused); hue 0 to 359, derived from the id when none is given. A brain holds at most 100
spaces, so `GET /spaces` is bounded by refusing the 101st rather than by cutting the list.

**The endpoints** are `GET /spaces`, `POST /spaces`, `GET`/`POST`/`DELETE /spaces/<id>`,
`GET /spaces/<id>/memory` (`<id>` may be `core`) and `POST /spaces/<id>/memory/<mem_id>/core`, in
`src/athena/spaces/routes.py`, mounted beside the adopt studio's and outside the daemon's writer
lock. The answers are the contract's shapes key for key (`SpaceSummary`, `SpaceErased`,
`SpaceMemoryRow`, `contracts/spaces.py`). A refusal is the one error shape; `bad_request` and
`space_busy` ride as the finer `error` word beside a `reason` from `ERROR_REASONS`
(`validator_failed`), as the delegated tasks' refusals do (ADR 0141).

**The memory stamp.** Episode, fact and procedural frontmatter gains an optional `space: spc_…` key
(the five fixed keys stay byte-compatible; core omits it); `companion_node` gains
`space TEXT NOT NULL DEFAULT ''` and an index on `(space, kind)`, derived from disk like every
column, and sleep proposals carry it too. The writers take `space: str = ""`. A fact written in a
space may cite only episodes visible there.

**Visibility is one predicate**, `visible_spaces(active)`: core sees `("",)`; a space sees
`("", active)`. Every recall lane filters by it, except the always lane that feeds the static
`memory.always` block, which is core's alone (it is cached for a conversation's life, so it cannot
move with the space). **Fail closed:** a stamp whose space file does not exist is never active, so
it is never visible; a request naming a space that is not on disk is refused, never read as core.

**The turn.** `POST /run` takes `space_id` (omitted or `""` is core). One that is not a `spc_` id,
or names no space on disk, is 400 `unknown_ref` before the stream opens. When the turn names a
saved case (`case_id`, or `project_id` standing in for it), **the case's space wins, always** -
including core: a chore is filed where it was adopted or linked, so a core chore run from inside a
project writes to core, never into that project's wall, and a project's chore run from core runs in
its project. A case filed under a space whose file is gone runs in core (fail closed). A case id
that names no saved case leaves the turn where the body asked. `TurnContext.space_id` carries the
answer; every memory the turn writes is stamped with it; a writer with no turn writes core.

**The frame.** A turn in a space gets `frame.space` (budget 6,000 characters, a tripwire like every
budget): `## Project: <name>`, the brief, `Apps in this project: <hosts>` and `### Kept for this
project`, the space's own always-tier facts and procedurals with `memory.always`'s ranking, caps and
quoted-line rendering. The name and the brief are the person's own words and are not fenced, as
`frame.project` is not; the kept lines are neutralised by the quoted-line helper. A core turn has
no `frame.space`. `frame.project` is untouched: a turn may have both a chore's case and a project.

**Chores.** A case's JSON block gains `space_id` (`""` is core) and `CaseSummary` carries it, Python
and TypeScript together. `CASE_SCHEMA` stays 1: a file written before projects has no key and reads
as core. `POST /adopt` takes an optional `space_id` the approve writes into the case (a reopen that
names none keeps the case's own); `POST /adopt/cases/<proj>/space {space_id}` links a case to a
space or, with `""`, returns it to core.

**Erase.** `DELETE /spaces/<id>` is 409 `space_busy` while a turn runs in the space, and no turn
starts in a space while it is being erased. It deletes every memory file stamped with the id, their
index rows (full-text, fact, procedural, provenance) and the proposals stamped with it; sets
`space_id: ""` on every linked case (the chores and their runs survive, back in core); and removes
the space file last, so a crash part way leaves a project still listed whose erase can be pressed
again. It answers what went: `{id, episodes, facts, procedurals, chores_unlinked}`. A core fact
that cited an erased episode keeps the citation, which is what the brain already does for a source
that is gone: the write gate refuses a source that is not a live episode *at write*
(`Brain.write_fact`), but a rebuild indexes a file's `sources` as written, without re-running the
gate (`core/brain/reconcile.py`), so the citation stays in the file and in `companion_provenance`
and counts in `source_counts`. Erase asks twice in the desktop and cannot be undone.

**Not in v1.** Spaces are not replicated to paired devices: a project lives on the PC it was made
on. **A space never enters the trust key**: the gate, the origins table, first-sight gating and
every tool class are the same in every space; a project changes what Athena remembers and is told,
never what she may do. No per-space engine, no archive or restore, no renaming of the `proj_`
vocabulary.

## Consequences

- Memory written before this change is core and stays visible everywhere; nothing is migrated.
  The index schema moves from 2 to 3 for the new column, and a brain's first start under it
  rebuilds the index from disk.
- Recall's SQL gains a `space IN (...)` filter on the hottest path; the performance gate measures it.
- A sleep pass consolidates each space's episodes separately, core first, within the same total
  caps, so it never distils one belief from two projects; proposals move with that.
- The always tier of a space rides in the frame, not in the static prompt, so switching projects
  never churns the system prompt's cache; a space's kept facts cost frame characters every turn.
  A full brief plus a full kept tier at the 400-character line cap runs past 6,000 and is then a
  warning on the composition, never a cut.
- A project's brief is the person's own and is composed unfenced every turn in it; a brief that
  says "ignore your law" is the person speaking, as a typed message is.
- Erasing a project is irreversible and takes its memory with it; its chores are kept. A core fact
  can therefore cite an episode that no longer exists, as it already could after a manual delete.
- The space-stamped memory, the recall filter and the sleep partition land in a second work
  package; until then `spaces/memory.py`'s seams answer zero counts, an empty memory page, nothing
  to make core's and nothing to erase, which is the truth while nothing carries a stamp.

## Memory wall

Date: 2026-10-25 (second work package). Registry: `agent-memory` / owner-and-counterpart scope -
the scope is stamped once, at write, by the path that captured the memory; recall applies the
request's view and never a value the memory chose for itself; moving a memory across scopes is an
explicit act, never a query that happens to span them.

**The stamp.** `Brain.append_episode`, `write_fact` and `write_procedural` take `space` (`""` or a
`spc_` id, anything else `ValueError`) and write `space: "spc_…"` after every other key but
`device`, so a core file and a file from a PC that never paired keep their bytes.
`companion_node.space` is filled from it by the writers, by `receive_file` and by the rebuild's
per-file step, which reads a `space:` value that is not a space id as `?` - a stamp no view
contains (fail closed, never core). The index is `companion_node_by_space (space, kind,
importance)`: the contract's `(space, kind)` with `importance` third, because recall's population
counts ask `importance > 0` (or `>= 4`) inside the wall and without it each count read every row
of its kind (0.09 ms to 1.7 ms over 5,000 nodes, most of a measured 10% recall regression; with it
the regression is under 3%).

**Upgrading an index (schema 2 to 3).** Not a rebuild. On first open the brain adds
`companion_node.space` and `companion_proposal.space` (`ADD COLUMN ... DEFAULT ''`: every row reads
core), creates the index, and - because a v2 build may have received a stamped file from a paired
device - reads the header of every indexed episode, fact and procedural file once and sets the
column for each stamped one, in the same transaction as the stamp. Index-only values (a demotion,
fade, use) survive, which a rebuild would reset. A file the scan cannot read keeps its row, as a
rebuild would skip it. A build older than this one opening a v3 index leaves the stamp at 3 and
writes `''` for its own rows, which is right: it stamps nothing.

**What crosses the wall at write, and what is refused.** A fact or procedural written in space S
cites only live episodes whose space is in `visible_spaces(S)` - refused as `ProvenanceError`, the
same path as a dead source, so a project fact never stands on another project's words and a core
fact never on a project's. It closes (`supersedes`) only memories of exactly S: recall serves the
successor and never what it closed, everywhere, so a project fact closing a core one would take it
from core and every other project. `receive_file` runs the same gate with the file's own stamp.

**Recall.** `recall` and `recall_whole` take `space`; every lane adds `n.space IN (...)` for
`visible_spaces` of it, and a space with no file on disk is answered as core (`seen_from`, the one
place recall stats the disk). The always block - `memory.always`, static - is `space = ''` alone.
`space_always(brain, space)` is a space's own always tier, ranked, capped and quoted as
`memory.always` is, with its honest total; `frame.space` renders it as "Kept for this project", and
`recall` in that space leaves those memories out of the keyword lane so nothing prints twice. Its
budget is 8,000 characters (a brief at the cap, 24 apps and a full kept tier at the 400-character
line cap measure 7,745); a tier whose every character JSON-escapes still runs past it and is a
warning, never a cut. `core.recall` answers in the turn's space.

**Who stamps.** The browser lane stamps every episode a turn appends with `TurnContext.space_id`;
`core.write_fact` and `core.checkpoint` stamp with it. A card carries the space of the turn that
filed it on its row (`companion_approval.space_id`, an added column) and `POST /decisions/<id>`
answers in that space - the case's when the card's turn ran under one - so an approved fact and a
declined card's episode land where they were asked for, however long the card waited; a card whose
project was erased since is refused 400 `unknown_ref`, and an answer counts as a turn in the space
while it runs, so an erase waits for it. A delegated task stores the delegating turn's
`space_id` (`companion_task.space_id`, not on the wire); every turn of the task runs in it whatever
the window sends, its harvest episode is stamped with it, and a task whose project is gone is
refused before its turn. A chore approval's episode and facts carry the case's space. A writer with
no turn writes core.

**Sleep.** The cycle reads the window as before and partitions its take by the episode's stamp:
core first, then each space by its most recent episode; an episode stamped with a space that has no
file is read past, counted (`space_unknown`) and journalled, never distilled. Every partition is
compressed before anything is written, so a failed leg still writes nothing and keeps the
boundary. The take already holds the 120-episode and 30,000-character caps; the fact, procedural
and supersede caps are spent across partitions in that order, so they stay the cycle's totals.
Each partition is merged on its own: its shortlist and key prefilter see only what its space can
see, a verdict that would close a memory of another space is written as new beside it, and the
forget bars that apply are those its space can see (a core forget bars a key everywhere, a
project's only there). Facts, procedurals and contradiction proposals carry the partition's space;
a forget proposal and the marker a forget writes carry the forgotten memory's, and the marker cites
those of its sources that space can still see.

**The two explicit acts.** *Make core* (`Brain.unstamp`) rewrites the file whole without its
`space:` line - every other byte kept - and sets the row's `space` and `content_hash`; only a
fact or procedural whose file says that space is moved, else 404 `unknown_ref`. Its citations are
kept, so a core fact may cite a project's episode; recall never follows a citation, so nothing of
the episode is shown outside its project. *Erase* (`Brain.erase_space`) collects what the index
holds under the space and what the disk holds under it (a file whose row a crash lost), deletes
the files first and then every row naming them - node, full-text (by rowid and by `node_id`),
fact, procedural, provenance, supersedence on either side, use and fade - and the proposals
stamped with the space; files first, so an erase pressed again after a crash still finds the rows.
A core memory citing an erased episode keeps its citation, as the existing code does for any
source that is gone: recall reads no provenance, so it is recalled as before; the rebuild writes
`sources` back as the file says without re-running the gate (`reconcile.index_file`); only a new
write must cite live, visible episodes, so a forget marker for it cites whichever sources remain.

**Amended above.** "A brain's first start under it rebuilds the index from disk" is the column
migration and header scan described here, not a rebuild; `frame.space`'s budget is 8,000, not
6,000; and the seams in `spaces/memory.py` now answer from the stamp.

**Known limits.** A stamped memory replicates to a paired PC like any other, but the space file
does not, so there it is visible nowhere until projects replicate; erasing a project on one PC does
not erase its copies on another. A promoted fact whose sources are all in its old project cannot be
forgotten through a proposal: its marker is core's and would cite nothing core can see. A downgrade
to a build before the wall that rebuilds its index writes `''` for stamped files, and the next
open of this build does not rescan (the stamp says 3); `athena brain reconcile` restores the wall.
