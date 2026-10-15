# 0114. What she says is written for the ear

Date: 2026-10-15

Amends [0019](0019-voice-is-a-socket-on-the-daemons-port-and-a-transport-around-the-one-lane.md):
its spoken line was "the `TTS:` line, else the text cut to the cap and announced". The cap stays
the parser's bound on a `TTS:` line. The fallback is now cut to a spoken budget below it, by
sentence, and both pass one speech door first. Leaves the argv safety of
[0069](0069-a-spoken-sentence-never-starts-with-a-dash-at-the-engine.md) unchanged.

## Context

The capability block teaches the model the `OP:` line and nothing about `TTS:`, and no prompt,
constitution or frame file mentions it. So in practice every spoken reply was the fallback in
`voice/tts.py`: the reply's visible text, written for the eye, up to `TTS_CAP` (1,200 characters,
about 80 seconds of speech), cut at character 1,200 wherever that fell, mid-word or mid-URL.

An engine voices what it is given. Kokoro read "asterisk asterisk", spelled
`https://ledger.example.com/inv/7` out, read bullet dashes and read code line by line. And
`kokoro.split_sentences` ended a sentence at any stop followed by a space, so "Dr." and "e.g."
ended one, and only the fold of short fragments hid it.

## Decision

1. **One door.** `channels/voice/speech.py` is pure and owns the rules. `speakable(text)` drops
   emphasis, strike, heading and quote marks; a list item or a heading is its own sentence;
   `[label](url)` is its label; a bare URL is "a link to <host>"; a fenced block is the one
   sentence "There is code on screen."; inline code is its content; a table is "There is a table
   on screen.". A reply of markup alone says nothing.
2. **One sentence rule.** `speech.sentences` does not end a sentence at a decimal, at a known
   abbreviation (Dr., Mr., e.g., i.e., vs. and a few more) or at a stop before a lowercase word,
   and keeps closing quotes and brackets with their sentence. `kokoro.split_sentences` calls it
   and keeps its fold of short fragments, so the chunker and the budget cut in the same places.
3. **A spoken budget.** `SPOKEN_BUDGET` is 360 characters, about 20 to 25 seconds. A fallback
   longer than it is spoken as the whole sentences that fit, then `PromptBlock.footer()` counted
   in sentences: "(showing 3 of 9)". A run-on sentence longer than the budget is cut between
   words into pieces that count as sentences. Only a single word longer than the budget is cut
   inside itself.
4. **The door runs on the `TTS:` line too.** The model's own line passes `speakable` but not the
   budget, since the parser already holds it to `TTS_CAP`. A `TTS:` line with no words left falls
   back to the text.

## Consequences

- No reply reads markup or URL paths aloud, and a long one stops at a sentence after about 20
  seconds, saying how many sentences are left on screen (README section 2, invariant 4).
- `voice.speaking.text` is what was said, so the halo caption and the panel show the spoken form,
  not the visible one.
- The footer's unit changes from characters to sentences. The gateway and command tests that
  pinned `(showing 1200 of N)` now pin the sentence count.
- A short reply with no markup is spoken byte for byte as before.
- Rollback is one revert: `speech.py` is new and pure, and nothing is stored.
