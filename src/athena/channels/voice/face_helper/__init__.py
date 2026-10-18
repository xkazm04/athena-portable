"""voice-io / ADR 0120 (Athena has a face): the face helper, run in another interpreter.

This package is never imported by the daemon. :class:`athena.channels.voice.face.FaceHelper`
starts it with the Python the person configured (``face.python``), loading this directory under
the name ``athena_face_helper`` so it shadows nothing in that environment, and speaks JSON lines
with it over stdin and stdout. That environment brings what the daemon must not: numpy and
onnxruntime for the mouth shapes, torch, scipy, librosa and JoyVASA for the motion. Every import of
them is inside a function, so mypy and ruff read these files with the rest of ``src/athena``
while the daemon's import graph never reaches them.

- :mod:`.main` — the protocol: ``hello``, then ``sentence`` in and ``visemes`` / ``motion`` out.
- :mod:`.visemes` — token spans to Oculus-15 mouth shapes (the spike's WP-L rules).
- :mod:`.motion` — a sentence's audio to RigParams v1 head, eye and brow frames (JoyVASA plus the
  decoder in ``decoder.json``, retargeted with the glow profile).
"""
