# Licences of Athena's face models

Checked 2026-10-18 against primary sources (GitHub LICENSE files, Hugging Face model cards, dataset
pages). Not legal advice: two questions below are legal, not factual, and are marked so.

## What the shipped helper loads

`src/athena/channels/voice/face_helper/motion.py` builds JoyVASA's `LivePortraitWrapper`, which loads
the five LivePortrait weight files (F, M, W, G, S), JoyVASA's `motion_generator_hubert_chinese.pt`
with `motion_template.pkl`, and `chinese-hubert-base` (the `hubert_zh` branch of
`dit_talking_head.py`). InsightFace is not reached: only `cropper.py` loads `FaceAnalysisDIY` /
`buffalo_l`, and nothing on the wrapper's import chain imports it. None of these files is in the
installer: the user places JoyVASA at `~/.athena-avatar/models/joyvasa` and points `face.python` at
an environment that has it. Kokoro and sherpa-onnx are downloaded from upstream by `install.py`
with pinned hashes.

## The table

| Component | What we use | Code | Weights | Commercial | Duties | Source |
|---|---|---|---|---|---|---|
| JoyVASA (jdh-algo) | wrapper, DiT motion generator, motion template | MIT | MIT (HF `license: mit`) | yes | copyright + permission notice | github.com/jdh-algo/JoyVASA/blob/main/LICENSE; huggingface.co/jdh-algo/JoyVASA. Training data "a hybrid dataset of private Chinese and public English data" - not named |
| chinese-hubert-base (TencentGameMate) | audio encoder | no LICENSE in the GitHub repo | MIT (HF `license: mit`) | on the label yes; **provenance risk** | MIT notice | huggingface.co/TencentGameMate/chinese-hubert-base. Pretrained on WenetSpeech, "available to download for non-commercial purposes" (wenet-e2e.github.io/WenetSpeech) |
| LivePortrait (KwaiVGI) | F, M, W, G, S | MIT | MIT | yes, without InsightFace | MIT notice | its LICENSE: commercial use requires removing InsightFace's detection models |
| InsightFace buffalo_l | spike calibration only | MIT | non-commercial research only | **no** | never ship or auto-download | github.com/deepinsight/insightface |
| Kokoro-82M | TTS weights (`kokoro-multi-lang-v1_0`) | - | Apache-2.0 | yes | Apache text + NOTICE; credit Koniwa (CC BY 3.0), SIWIS (CC BY 4.0) | huggingface.co/hexgrad/Kokoro-82M |
| misaki | a phoneme table copied into `visemes.py` | Apache-2.0 | - | yes | attribution | github.com/hexgrad/misaki |
| sherpa-onnx + espeak-ng | `sherpa-onnx-offline-tts.exe`, `espeak-ng-data` | Apache-2.0; espeak-ng GPL-3.0-or-later, **statically linked** | data GPL | yes | see GPL below | github.com/espeak-ng/espeak-ng |
| ARTalk (xg-chu), fallback candidate | - | MIT | MIT | code + weights yes; **FLAME no** | MIT notice | needs `FLAME_with_eye.pt`; FLAME's academic licence forbids commercial use and redistribution; only "FLAME 2023 Open" allows commercial use |
| facebook/hubert-base-ls960 | candidate encoder for a distilled student | - | Apache-2.0 | yes | Apache notice | huggingface.co/facebook/hubert-base-ls960 |

## GPL and the voice engine

espeak-ng is statically linked into the sherpa-onnx executable, so that executable can only be
conveyed under GPL-3.0. While `install.py` downloads it from k2-fsa's releases we do not convey it.
If an installer ever bundles it: include the GPL-3.0 text, provide the Corresponding Source for that
exact build (or a written offer valid for three years, GPL-3.0 section 6), add no further
restrictions, and keep it replaceable. Running it as a separate process, talking through CLI
arguments, WAV files and text lines, keeps Athena's own code outside the GPL (GPL FAQ: separate
programs communicating at arm's length); it does not remove the executable's own source duty.

## A distilled student

A small model we train on JoyVASA's outputs is our work (MIT does not restrict outputs). It inherits
what it reuses at inference: with chinese-hubert-base as its encoder it carries that model's
WenetSpeech risk. Re-extracting its features with facebook/hubert-base-ls960 (Apache-2.0) leaves only
MIT and Apache terms; JoyVASA's undisclosed training data still shapes its behaviour.

## Verdict

- **Can ship by default:** our code, Kokoro (Apache NOTICE + CC BY credits), the viseme table, a
  student on an Apache-licensed encoder.
- **Keep user-installed / optional:** JoyVASA + LivePortrait, chinese-hubert-base, sherpa-onnx (GPL
  source duty if bundled), ARTalk (its FLAME file must be user-obtained).
- **Never ship:** InsightFace buffalo_l, FLAME academic.
- **NOTICE entries when anything here is distributed:** JoyVASA (MIT), LivePortrait (MIT),
  chinese-hubert-base (MIT) or facebook HuBERT (Apache), Kokoro (Apache + CC BY credits),
  sherpa-onnx (Apache), espeak-ng (GPL-3.0 + source pointer), misaki (Apache).
- **No blocker on the shipped path.**

## Not verified

- The training data behind the JoyVASA weights.
- Whether WenetSpeech's non-commercial term carries into chinese-hubert-base's MIT weights (legal).
- The licence of `TencentGameMate/chinese_speech_pretrain` (none stated).
- The dataset terms behind ARTalk's weights (the spike notes say partly HDTF).
