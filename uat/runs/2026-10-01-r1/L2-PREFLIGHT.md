# L2 preflight (arms measured on this host, 2026-10-01)
| precondition | value | consequence |
|---|---|---|
| claude CLI | present, `claude --version` 2.1.285 | Mira/juror arm real; the Codex-only / claude-absent arm (priya-1,2,3,4,6; juror-1) is NOT built: renaming the user's CLI binary is out of scope. Resolves uncertain unless the probe-unwired finding shows live with claude present. |
| codex CLI | present on PATH | the "codex absent" arm cannot be built either |
| display scaling | host native; cannot be changed from here | ana-10 (150% work area), ana-14, ana-2 (NVDA) resolve uncertain: not reproducible on this host |
| decision-card fixture | one real gated turn via the user's Claude CLI on ledgerbox :3001 | spends subscription; nothing executes (all GATED) |
| store | throwaway ATHENA_STORE, fresh for J1 | residue: recorded in RESIDUE.md |
| voice | no backend/microphone | voice paths uncertain |
