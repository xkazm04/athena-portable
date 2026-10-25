# 0167. An unread application evidences nothing

Date: 2026-10-25

Builds on the hirelane design law's first rule ("the unscored are expressed by absence") and ADR
0162 (the board's agent reads). Governing standard: status-vocabulary (absence is not a zero).

## Context

`lib/board/index.ts` draws an unscored applicant with `blank()`, a full row of zero scores, so
the layout keeps one shape. It then derived the evidence facets from that row: `meta.evidenced`
(0), `band` ("wide") and `bandDrivers` (every criterion). `overall` was held by the `scored` flag,
which each reader had to remember; the evidence facets had no such rule, and four readers printed
them. Designer screening, four applications nobody has read, said "0 of 20 criteria evidenced";
each slide said "0 of 5 criteria evidenced" with five dark pips; the dossier said "0/5 evidenced"
beside "not scored"; the agent's dossier read said `criteria_evidenced: "0 of 5"`. Each is a claim
that the application was read and holds nothing.

## Decision

1. **The evidence facets are one nullable sub-object.** `BdCandidate.evidence: BdEvidence | null`
   (`evidenced`, `criteriaCount`, `band`, `drivers`) replaces `band`, `bandDrivers`,
   `meta.evidenced` and `meta.criteriaCount`. It is built only by `evidenceOf(stored, n)` in
   `lib/board/read.ts`, from the stored scorecard, and is null when there is none. `blank()` stays
   for the score rows the layout needs; nothing is derived from it.
2. **The column sentence is a pure model function.** `screeningFact` in
   `components/board/model/evidence.ts` sums only the read, names how many are unread ("· 1 not
   read yet"), and says "Nobody here has been read against the rubric yet." when none are.
3. **Readers render the null as absence.** The slide says "not read against the rubric yet" with
   no pips, the dossier drops its evidenced figure, the band label is drawn only with evidence,
   and the agent reads drop `confidence`, `uncertain_because` and `criteria_evidenced` exactly as
   they drop `overall`.
4. **The type holds the rule, not a flag.** A reader cannot reach `evidence.band` without
   narrowing; `test/evidence.test.ts` pins that with a `@ts-expect-error`, so the field cannot
   quietly become non-nullable.

## Consequences

- Scored candidates' values are unchanged: tests re-derive the base tree's arithmetic from the
  stored scorecards and compare it to `evidence` and to `candidateRead`.
- `overall`/`fit` remain flag-guarded. Folding the whole scored state into one `assessment | null`
  is the end state, but it touches eleven board-ui readers and is left as a separate change.
