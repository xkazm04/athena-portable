"""WP-V of the nvidia-revisit spark: does Nemotron-3.5-Super-VL read a person's documents?

Renders documents from the adopt-tier fact sheets (ground truth by construction), has the VL
model and the Claude documents lane read them, and scores both with pure code. Every output goes
to the gitignored ``proving-runs/<ts>/docread/``.
"""

from __future__ import annotations
