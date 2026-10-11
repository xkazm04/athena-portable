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

Council full round 1, robustness-1. The guard above tested only an ASCII `-`. Under a narrow
Windows argv (code pages 1250 and 1252) U+2010, U+2011, U+2012, U+2015, U+2212 and U+FF0D are
folded to `-`, so a sentence starting with one of them reached the engine as an option and the
guarantee did not hold. A deny-list of code points depends on the code page and is never complete.

`spoken_entry` now prefixes exactly one space to every sentence (after `split_sentences` has
stripped it), whatever it starts with. The entry cannot begin with `-` under any parser or code
page. espeak ignores the space, so no word is dropped. The earlier rule that a sentence without a
leading dash passes byte for byte is withdrawn on purpose: the tests that pinned it now pin one
space first and the sentence otherwise byte for byte, for the six folded code points, U+2013,
U+2014, U+FE63 and an ASCII `--` sentence. Playbook narration gains one inaudible space.

## Amended 2026-10-11

Council full round 2, robustness-2. The first amendment's "cannot begin with `-` under any parser
or code page" held for the first byte of the entry, but not for where the entry ends.
`subprocess.list2cmdline` quotes the positional with an ASCII `"` and escapes the wide string.
`sherpa-onnx-offline-tts` has a narrow `main`, so it reads the ANSI command line, which Windows
builds with `WideCharToMultiByte` and best fit: U+FF02 becomes `"` and U+FF3C `\`. The council's
probe under code page 1250, `Read this ＂ --output-filename=C:/Users/Public/pwned.wav ＂ now
please`, split under `CommandLineToArgvW` into ` Read this `,
`--output-filename=C:/Users/Public/pwned.wav` and ` now please`; the harmless `He said ＂hello
there＂ to me today` split too.

**The rule.** Before a sentence becomes argv, `kokoro.narrow_safe` replaces every character the
child's ANSI code page cannot carry exactly. A character is carried when encoding it to that code
page without best fit (`codecs.code_page_encode` with `strict`, which passes
`WC_NO_BEST_FIT_CHARS`), then decoding it back, gives the same character. The rule is defined by
the code page, never by a list of code points, for the reason the first amendment withdrew the
dash deny-list. Once every character is carried, the narrow line decodes back to the wide line
exactly, so the child splits where `list2cmdline` quoted. On Windows the code page is the
process's `GetACP()`, read once at import (`kokoro.ANSI_CODE_PAGE`); a child inherits it.
Elsewhere argv is bytes with no best fit, and the function is the identity. The pure function
takes the code page as a parameter, so tests pin 1250 and 1252. The one leading space stays.

**What a character that is not carried becomes**, tried in order, each kept only if every
character of it is carried:

1. its NFKC form. U+FF02 becomes `"` and U+FF3C `\`, which `list2cmdline` then escapes
   correctly; a ligature becomes its letters and a fullwidth letter its ASCII letter. This is
   chosen for speech: the word is still read.
2. its NFKD form with the combining marks dropped. Under 1252, `ř` becomes `r`, which is what
   best fit gave the engine before this change, so a Czech sentence under a Western code page
   reads no worse than it did.
3. one space. A space rather than nothing, so a dropped character never runs two words together
   into a third that was never said.

A character that is carried is never touched, so a word made only of carried characters never
changes: `Příliš žluťoučký kůň úpěl` under 1250 is byte for byte the same after the leading space.
Only characters the code page lacks are folded; NFKC is not applied to the whole sentence, because
it would rewrite carried characters such as `²` under 1252.

U+0000 is not made safe here: no command line can hold it, and `Popen` refuses it before any
process starts, which the render thread already reports as a `VoiceBackendError`.

**Tests** (tests/channels/test_voice_engines.py), through the narrow line: `build_args`, then
`list2cmdline`, then `codecs.code_page_encode(cp, line, 'replace')` (best fit) and back, then
`CommandLineToArgvW`. The council's two sentences under 1250 and 1252, and every BMP code point but
U+0000 and the surrogates on both sides of `--output-filename=x` under 1250, 1252 and the running
code page, give exactly the flags plus one positional that starts with a space. A fullwidth
backslash at the end does not escape the closing quote; an ASCII quote and backslash reach the
positional as themselves. Nothing runs the engine. Whether sherpa-onnx would act on a split token
is still unobserved; the argv layer no longer offers one.
