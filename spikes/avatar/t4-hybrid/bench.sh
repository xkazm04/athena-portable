#!/usr/bin/env bash
# t4-hybrid end to end: WP-L WAVs -> JoyVASA motion (GPU, locked) -> RigParams -> t1 rig capture.
#   bash spikes/avatar/t4-hybrid/bench.sh [<portrait-id>]
# Without a portrait id it stops after the RigParams (motion needs no portrait).
set -euo pipefail
cd "$(dirname "$0")/../../.."                      # repo root
H="${ATHENA_AVATAR_HOME:-$HOME/.athena-avatar}"
PY="$H/venvs/t4-hybrid/Scripts/python.exe"; [ -x "$PY" ] || PY="$H/venvs/t4-hybrid/bin/python"
T=spikes/avatar/t4-hybrid
export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 PYTHONIOENCODING=utf-8   # JoyVASA ckpt pickles its args
LINES="calm question long"
A=""; for l in $LINES; do A="$A --wav $H/voice/$l.wav --out $H/voice/t4-hybrid/$l.motion.npz"; done
python spikes/avatar/tools/gpulock.py --label "t4-hybrid: joyvasa motion" -- "$PY" $T/t4/neural_motion.py --seed 7 $A
node $T/ab/procedural.mjs $LINES
for l in $LINES; do
  "$PY" $T/t4/retarget.py --motion "$H/voice/t4-hybrid/$l.motion.npz" --decoder $T/t4/decoder.json \
    --timeline "$H/voice/$l.timeline.json" --out "$H/voice/t4-hybrid/$l.rigparams.json"
  "$PY" $T/t4/compare.py --line $l --a "$H/voice/t4-hybrid/$l.procedural.rigparams.json" \
    --b "$H/voice/t4-hybrid/$l.rigparams.json" --wav "$H/voice/$l.wav" \
    --json "$H/voice/t4-hybrid/$l.ab.json" --png "$H/voice/t4-hybrid/$l.ab.png" > /dev/null
done
[ $# -ge 1 ] || { echo "RigParams in $H/voice/t4-hybrid/ (no portrait id given: no bench clips)"; exit 0; }
P="$1"
mkdir -p "$H/portraits/$P/t4-hybrid"
PROFILE=human
grep -q '"rig_type": *"glow"' "$H/portraits/$P/t1-rig/layers/layers.json" && PROFILE=glow
[ $PROFILE = glow ] && node $T/ab/procedural.mjs --scale 0.7 $LINES
for l in $LINES; do
  "$PY" $T/t4/retarget.py --profile $PROFILE --motion "$H/voice/t4-hybrid/$l.motion.npz" --decoder $T/t4/decoder.json     --timeline "$H/voice/$l.timeline.json" --out "$H/portraits/$P/t4-hybrid/$l.rigparams.json"
  if [ $PROFILE = glow ]; then
    cp "$H/portraits/$P/t4-hybrid/$l.rigparams.json" "$H/voice/t4-hybrid/$l.glow.rigparams.json"
    "$PY" $T/t4/compare.py --line $l --a "$H/voice/t4-hybrid/$l.procedural-glow.rigparams.json"       --b "$H/voice/t4-hybrid/$l.glow.rigparams.json" --wav "$H/voice/$l.wav" --json "$H/voice/t4-hybrid/$l.glow.ab.json" > /dev/null
  fi
done
python spikes/avatar/tools/gpulock.py --label "t4-hybrid: bench $P" -- node spikes/avatar/web/capture.mjs --portrait "$P" --track t4-hybrid --port 5183 \
  --params-dir "/home/portraits/$P/t4-hybrid"
"$PY" $T/t4/patch_metrics.py --portrait "$P"
