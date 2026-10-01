# What this run wrote (uat skill: own runs are a data source)
- Throwaway store `scratch/fresh.sqlite` (git-ignored): settings (onboarded, theme flipped once), origins localhost:3001 and 127.0.0.1:3001, one
  pending approval `apr_23e30fb6cf68` (send_reminder, inv_0002), one declined approval (inv_0029), tabs.
- ledgerbox's own sqlite (`examples/ledgerbox/data/ledgerbox.sqlite`, git-ignored; `git status` is clean for it): drafts saved for inv_0002 and inv_0029 by the
  model's tool calls; NO reminder was sent (the only approval answered by a user was declined; the approve was refused as foreign_origin).
- The daemon's brain directory is the user's real one (ATHENA_STORE does not isolate it, finding uat-4): this run's turns are now episodes in it.
- Model calls on the user's Claude subscription: about 9 rounds + 3 later turns, ~$1.6 by the Record's own figures (API-equivalent).
