# 0137. Five weak chores are cut, and the stills are re-shot without figures

Date: 2026-10-23 (spark refilm-prep)

## Context
The chores UAT (ADR 0132, run 2026-10-23-chores) and its recertify scored every playbook on the judges' pass rate,
"would not adopt" verdicts, field errors the walkers found, the bench verdict, the money it returns and its rank.
Five came out weakest: osha-300-log (short on the bench, no money, unranked), fsa-acreage-reporting (no money, rank
94, 10% judge pass), wotc-screening (the credit lapsed for hires after 31 Dec 2025, so its premise is gone),
provider-revalidation (no money, rank 93) and credit-report-disputes (rank 95, three field errors). Separately, the
evidence stills photograph a page that no longer exists, two of the six bake in figures the page now shows live
(recertify R-1), and thumb.jpg is rendered by no component yet ships 8.5 MB in the installer.

## Decision
- The five are deleted from `playbooks/` (git history keeps them) with their UAT pairs and case cards; the roster is
  95 (amends ADR 0057). The ranking is regenerated.
- The stills are re-shot for the current page as five 1280 px WebP frames under 44,000 bytes: the "How it runs"
  drawing and four replay turns. No still shows a figure tile, ratio or verdict, so none can disagree with the page.
  thumb.jpg is retired. WebP over AVIF: at equal bytes AVIF smeared the small UI text (measured on a 1280-wide
  chores screenshot, 37 KB each), and packing already-compressed stills into an archive saves under 2%.
- Git history keeps the old media blobs; no history rewrite.

## Consequences
"100 playbooks" copy becomes 95 where it describes the live roster; records of earlier runs keep their numbers.
