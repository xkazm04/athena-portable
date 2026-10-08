# 0042. Recall matches any word, and shows where it matched

Date: 2026-10-07

Refines `core/recall.py` and `core/brain/text.py` (README §2 invariant 4, §1 tier 0). Found by the
medical-bills playbook (ADR 0040).

## Context

Tier 0 of the onboarding ladder is the promise that Athena carries a fact from one app into a
decision in another. In the product that path is memory: a page's answer becomes a system episode,
and in another tab she reaches it through `core.recall` or the episode window of her frame.

The second medical-bills bench showed the path failing. In Cedar, Athena asked her memory for the
Northstar EOB she had read in the insurer's tab, and got nothing back: "Nothing was recalled about
the Northstar claim or the plan's surprise-billing rules." Reproduced outside the model, two causes:

1. **Every word was required.** `fts_match` quoted each term and joined them with spaces, which
   FTS5 reads as `AND`. "Northstar anesthesia EOB claim surprise billing" matched no episode,
   because no single page of results holds all six words. Only the bare word "Northstar" did.
2. **An episode came back as its first 500 bytes.** A page of claims is longer than that, so even
   a match could arrive without the row it matched.

## Decision

1. **Any word, ranked.** The quoted terms are joined with `OR`, and BM25 ranks an episode that
   matches more of them first. Words of one or two letters and a short stopword list are dropped
   before matching, so "the" does not bring back everything; a query made only of those keeps its
   words. Every term is still quoted, so a question can never be read as query operators.
2. **The region that matched.** A matched episode longer than an excerpt is shown as the same
   500-byte budget, centred on the first word of the query it contains and marked `…` where cut,
   instead of its head. (FTS5's `snippet()` was tried first and rejected: at its 64-token limit it
   returned less text than the excerpt it replaced, which `tests/e2e/test_reads.py` caught.)

## Consequences

- A natural-language recall now returns what it should, and the keyword lane of distilled memory
  benefits the same way. A query that shares one common word with many memories returns more
  candidates than before; BM25 orders them and the block's own bound and footer still apply.
- The excerpt rule (500 bytes) stays the parity contract for the index column; the window is a
  read-time view of the same size and changes nothing on disk.
- Tests: a person's question finds the episode holding one of its words; a long episode shows the
  matched row past its head; a query of only common words still queries.
