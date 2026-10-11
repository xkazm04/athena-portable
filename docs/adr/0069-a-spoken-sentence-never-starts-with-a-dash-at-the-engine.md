# 0069. A spoken sentence never starts with a dash at the engine

Date: 2026-10-11

Implements README section 3.1 (voice) and ADR 0028. Closes the council-lite round 1
must-address, robustness-1 of voice-conversation.

## Context

`kokoro.build_args` puts the sentence last as a bare positional argv entry. The sentence is the
model's reply, shaped by pages it has read, so it can begin with `--`
(`--output-filename=pwned.wav hello`). A Kaldi-style parser, as sherpa-onnx's tools use, reads
such an entry as an option, and a later `--output-filename` can redirect the WAV. Kokoro is the
only place reply text becomes argv: Piper (`evidence.py:_piper`) takes text on stdin and
`whisper.build_args` takes only paths. Nobody has observed how sherpa-onnx parses argv, and the
engine is not run here, so the fix must not depend on it.

## Decision

`spoken_entry` prepends one space to a sentence that starts with `-`; `build_args` uses it. The
entry then cannot match `--` or a flag. espeak ignores leading white space, no word is dropped
and `-5 degrees outside.` still reads as minus five. A sentence that does not start with `-`
passes byte for byte, so every playbook narration is unchanged. No `--` end-of-options marker is
added: no committed code shows the engine honours one. The test fake now treats a trailing
`--` argument as a flag, so a regression shows end to end through `KokoroTTS.synthesize`.

## Consequences

- A leading dash costs one byte of text; nothing else changes on the argv.
- A guard on the text is stronger than a marker we cannot verify; it holds for any parser.
- Other voice findings wait for their own round.

## Amended 2026-10-11

Council full round 1, robustness-3. The guard above tested only an ASCII `-`. Under a narrow
Windows argv (code pages 1250 and 1252) U+2010, U+2011, U+2012, U+2015, U+2212 and U+FF0D are
folded to `-`, so a sentence starting with one of them reached the engine as an option and the
guarantee did not hold. A deny-list of code points depends on the code page and is never complete.

`spoken_entry` now prefixes exactly one space to every sentence (after `split_sentences` has
stripped it), whatever it starts with. The entry cannot begin with `-` under any parser or code
page. espeak ignores the space, so no word is dropped. The earlier rule that a sentence without a
leading dash passes byte for byte is withdrawn on purpose: the tests that pinned it now pin one
space first and the sentence otherwise byte for byte, for the six folded code points, U+2013,
U+2014, U+FE63 and an ASCII `--` sentence. Playbook narration gains one inaudible space.
