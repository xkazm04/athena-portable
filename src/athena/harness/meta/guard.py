"""The Standard-only guard: a Contributor-mode model never sees a person's data (spike 00 piece 5).

Meta's Contributor mode trains on prompts, files, context and responses (``meta-model-facts.md``
"Data use"). A Contributor id ends in ``-contributor``; every Meta role class calls
:func:`require_standard` with ``media.personal`` before it builds a request, so the refusal costs
nothing and sends nothing.
"""

from __future__ import annotations

from athena.senses.contract import Mode

__all__ = ["CONTRIBUTOR_SUFFIX", "ContributorRefused", "mode_of", "require_standard"]

CONTRIBUTOR_SUFFIX = "-contributor"


class ContributorRefused(ValueError):
    """A Contributor-mode model was asked to see a person's data."""


def mode_of(model: str) -> Mode:
    return "contributor" if model.strip().lower().endswith(CONTRIBUTOR_SUFFIX) else "standard"


def require_standard(model: str, personal: bool) -> None:
    """Raise :class:`ContributorRefused` if ``model`` trains on content and ``personal`` is set."""
    if personal and mode_of(model) == "contributor":
        raise ContributorRefused(
            f"{model} is a Contributor-mode model (Meta trains on what it sees); "
            "a person's data goes only to Standard models"
        )
