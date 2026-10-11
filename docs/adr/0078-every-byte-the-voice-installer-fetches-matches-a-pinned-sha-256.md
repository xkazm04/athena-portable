# 0078. Every byte the voice installer fetches matches a pinned SHA-256

Date: 2026-10-11

Implements README section 3.1 (voice). Extends [0028](0028-athenas-voice-is-set-up-in-a-studio-and-speaks-locally-by-default.md).
Closes the full-council round 2 findings craft-1 and robustness-6 of voice-conversation (one
defect, filed by two members at two severities).

## Context

ADR 0028 decided that "download URLs are constants in the daemon. The client never supplies one."
That pins the authority, not the bytes. `install.Sources` named four sources by URL only:

- `whisper_models` pointed at Hugging Face `resolve/main`, a branch that moves;
- `kokoro_model` pointed at sherpa-onnx's `tts-models` release, whose assets can be replaced (the
  pinned asset below was itself last replaced on 2026-09-08, years after the release was made);
- `_download` checked only the received byte count against `Content-Length`.

`extract_sherpa_engine` and `extract_whisper_engine` then write `.exe` and `.dll` files into the
engine home Personas shares, and `home.dry_check`, `kokoro` and `whisper` later run them as the
user. HTTPS proves the host, not the content: a replaced asset or a moved branch would be
installed and run without complaint.

## Decision

1. **A digest beside every URL.** `Sources.sha256` maps each URL to the lowercase hex SHA-256 its
   bytes must have: one for each of the three archives and one for each model in
   `whisper.MODELS` (six), nine in all. The map is keyed by the URL itself, so a URL changed
   without its digest has no pin.
2. **The model URL is pinned to a commit.** `whisper_models` is
   `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1`,
   never `main`.
3. **Hash as the bytes arrive.** `_download` folds `hashlib.sha256` into the existing `read1`
   loop, keeps the `Content-Length` check, and compares the digest before it returns, so before
   anything is extracted or moved into place.
4. **A mismatch deletes and fails.** The partial file is deleted (a whisper model's `.partial` in
   the models directory included), nothing is written to the engine home, the run's state is
   `failed`, and the error is `<file> does not match its pinned SHA-256 digest; nothing was
   installed`.
5. **No pin, no download.** A URL with no well-formed pin (absent, not 64 characters, not
   lowercase hex) is refused before any request: `<file> has no pinned SHA-256 digest; it is never
   downloaded`. A test's `Sources` supplies its own fixtures' digests; there is no bypass.

## Where each digest came from (all read 2026-10-11)

| Source | SHA-256 | From |
|---|---|---|
| `sherpa-onnx-v1.13.4-win-x64-shared-MT-Release.tar.bz2` (24,378,225 bytes) | `c312b30e…98b7879` | GitHub API `repos/k2-fsa/sherpa-onnx/releases/tags/v1.13.4`, the asset's `digest` (asset updated 2026-07-07); **cross-checked** by downloading and hashing it |
| `kokoro-multi-lang-v1_0.tar.bz2` (349,906,910 bytes) | `c5f7e2d2…128ea3298` | GitHub API `repos/k2-fsa/sherpa-onnx/releases/tags/tts-models`, the asset's `digest` (asset updated 2026-09-08) |
| `whisper-bin-x64.zip` (8,194,445 bytes) | `49dcc16d…192d674a` | GitHub API `repos/ggml-org/whisper.cpp/releases/tags/v1.9.2`, the asset's `digest` (asset updated 2026-08-04); **cross-checked** by downloading and hashing it |
| `ggml-tiny.en.bin` | `921e4cf8…89920b1f` | Hugging Face tree API `api/models/ggerganov/whisper.cpp/tree/5359861c…`, the file's LFS `oid` |
| `ggml-base.en.bin` | `a03779c8…afe36c6d002` | the same tree, LFS `oid` |
| `ggml-small.en.bin` | `c6138d6d…bf9c41e5d` | the same tree, LFS `oid` |
| `ggml-tiny.bin` | `be07e048…b1919c6e1b21` | the same tree, LFS `oid` |
| `ggml-base.bin` | `60ed5bc3…345fba2efe` | the same tree, LFS `oid` |
| `ggml-small.bin` | `1be3a9b2…c1fffea987b` | the same tree, LFS `oid` |

The full digests are the constants in `channels/voice/install.py`. The commit `5359861c…` is the
repository's head on 2026-10-11 (last modified 2024-10-29); a `resolve/<commit>` request for
`ggml-tiny.en.bin` answered with `X-Repo-Commit` equal to it and an `X-Linked-ETag` equal to the
pinned digest. Every API used gave a digest, so no asset had to be downloaded to be pinned; the
two cross-checks were downloaded into a temporary directory outside the repository, hashed and
deleted, and both matched the API.

## Consequences

- **Trust on first pin.** A pin proves the bytes have not changed since it was taken. It does not
  prove they were good when it was taken: the digests are the publishers' own, read once.
- **Bumping a pin** is changing the URL and its digest together, in one commit, with this table
  amended to say where the new digest came from. A URL changed alone has no pin and its download
  is refused, which is the reason the map is keyed by URL.
- **What the person sees on a mismatch.** The studio's install state turns `failed` with the
  sentence above, which names the file; nothing new is in the engine home, the earlier install
  (if any) is untouched, and pressing install again fetches again. An upstream that replaces an
  asset therefore breaks the one-click install until the pin is bumped, loudly and safely, rather
  than installing whatever is now there.
- **Personas' own installer** writes into the same engine home and is not changed here. A file it
  wrote is run by Athena as it finds it; this decision covers only what Athena downloads.
- Size and time ceilings on a download (economics-5) are not part of this decision.
