# 0073. A bare yes answers only a card this socket presented

Date: 2026-10-11

Implements README section 3.1 (voice) and ADR 0019. Closes the full-council round 1
finding robustness-3 of voice-conversation.

## Context

`VoiceSession._known_cards` returned the socket's own cards followed by the approval inbox, and
`approvals.pending` is oldest first. On a socket that had shown no card, `recognise` therefore let
"yes", "ok", "do it" and "no" answer the oldest pending card, one the user was never asked about
by voice. A card is consent to one action with its parameters on it; a word said to nothing is not
that consent.

## Decision

- A bare approve or decline word (`APPROVE_WORDS`, `DECLINE_WORDS`) answers only the newest card
  in `VoiceSession.cards`, the cards this socket presented.
- A pending card this socket never presented is answered only by its own option id or label, and
  only when exactly one such card fits the word. With none or several, the utterance is not an
  answer and goes on as a message.
- The inbox is ordered newest first, so `recognise`'s docstring is true.

## Consequences

- A fresh socket with one pending card still answers "decline" or "approve" by the option id.
- A fresh socket with two pending cards needs the user to look at one (or answer it in the panel).
- "yes" said to nothing becomes a message to the model, as any other sentence is.
