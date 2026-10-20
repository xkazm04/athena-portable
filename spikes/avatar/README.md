# Avatar spike

How premium can a talking Athena look and move from ONE generated portrait, built with open tools
and our own code on one RTX 4090? Three tracks answer it in parallel and render the same bench.

| Track | Dir | Route |
|---|---|---|
| WP-L voice timeline | `voice/` | Kokoro af_heart lines -> WAV + phoneme/viseme timeline |
| t1-rig | `t1-rig/`, `web/` | portrait -> layer split -> our WebGL mesh-warp rig, procedural idle, viseme mouth |
| t2-neural | `t2-neural/` | portrait + audio -> local open talking-head models |
| t4-hybrid | `t4-hybrid/` | audio -> neural motion -> RigParams -> t1's rig |

Read `CONTRACT.md` first: paths, ids, the GPU rule, and the three JSON shapes.

The only manual input is the operator's Leonardo portrait at
`~/.athena-avatar/portraits/<portrait-id>/portrait.png`. Until it lands, tracks build tooling,
download models and verify each install with the sample image that ships in a model's own repo
(a smoke test, under `portraits/_smoke/`). No stand-in Athena is generated and no bench clip is
rendered before the operator's portrait exists: the operator chose to wait for the real art.

Spark idea note: `.spark/Spark/ideas/athena-avatar.md` (vault, not in git).
