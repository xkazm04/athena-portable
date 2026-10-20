#!/usr/bin/env bash
# t2-neural: clone the model repos, create one uv venv per model, download weights.
# Idempotent; no GPU. Windows (Git Bash) as run on the spike machine; on Linux swap the
# Scripts/ paths for bin/ and the flash-attn wheel for the linux one.
#   bash spikes/avatar/t2-neural/setup.sh [ditto] [flashhead] [infinitetalk]
set -euo pipefail
H="${ATHENA_AVATAR_HOME:-$HOME/.athena-avatar}"
M="$H/models"; V="$H/venvs"
mkdir -p "$M" "$V"
export HF_HUB_ENABLE_HF_TRANSFER=1
HF="uvx --from huggingface_hub[cli,hf_transfer] hf download"
TORCH="torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128"
ARGS="$*"

clone() { [ -d "$2/.git" ] || git clone -q "$1" "$2"; }
venv() { [ -x "$V/$1/Scripts/python.exe" ] || [ -x "$V/$1/bin/python" ] || uv venv -q --python 3.10 "$V/$1"; }

if [ -z "$ARGS" ] || [[ " $ARGS " == *" ditto "* ]]; then
  clone https://github.com/antgroup/ditto-talkinghead "$M/ditto/repo"
  $HF digital-avatar/ditto-talkinghead --local-dir "$M/ditto/checkpoints"
  venv t2-neural-ditto
  VIRTUAL_ENV="$V/t2-neural-ditto" uv pip install -q $TORCH
  # cython blend builds through pyximport with MSVC (VS 2022 Build Tools) on first run
  VIRTUAL_ENV="$V/t2-neural-ditto" uv pip install -q librosa tqdm filetype imageio imageio-ffmpeg \
    opencv-python-headless scikit-image cython setuptools einops "numpy<2.1" scipy mediapipe==0.10.14 \
    onnxruntime-gpu==1.22.0 nvidia-ml-py "triton-windows<3.4"
fi

if [ -z "$ARGS" ] || [[ " $ARGS " == *" flashhead "* ]]; then
  clone https://github.com/Soul-AILab/SoulX-FlashHead "$M/flashhead/repo"
  $HF Soul-AILab/SoulX-FlashHead-1_3B --local-dir "$M/flashhead/SoulX-FlashHead-1_3B"
  $HF facebook/wav2vec2-base-960h --local-dir "$M/flashhead/wav2vec2-base-960h"
  venv t2-neural-flashhead
  VIRTUAL_ENV="$V/t2-neural-flashhead" uv pip install -q $TORCH
  # requirements minus linux-only nccl, xformers and the gradio UI; triton for torch.compile
  grep -v "nvidia-nccl\|xformers\|gradio" "$M/flashhead/repo/requirements.txt" > "$M/flashhead/req-win.txt"
  VIRTUAL_ENV="$V/t2-neural-flashhead" uv pip install -q -r "$M/flashhead/req-win.txt" einops \
    "triton-windows<3.4" nvidia-ml-py
fi

if [ -z "$ARGS" ] || [[ " $ARGS " == *" infinitetalk "* ]]; then
  clone https://github.com/MeiGen-AI/InfiniteTalk "$M/infinitetalk/repo"
  # fp8 path: the base DiT shards (66 GB) are not needed, only T5/CLIP/VAE/config + the fp8 DiT
  $HF Wan-AI/Wan2.1-I2V-14B-480P --exclude "diffusion_pytorch_model*" --local-dir "$M/infinitetalk/Wan2.1-I2V-14B-480P"
  $HF MeiGen-AI/InfiniteTalk quant_models/infinitetalk_single_fp8.safetensors quant_models/infinitetalk_single_fp8.json \
    quant_models/t5_fp8.safetensors quant_models/t5_map_fp8.json quant_models/quant.json --local-dir "$M/infinitetalk/InfiniteTalk"
  $HF TencentGameMate/chinese-wav2vec2-base --local-dir "$M/infinitetalk/chinese-wav2vec2-base"
  $HF TencentGameMate/chinese-wav2vec2-base model.safetensors --revision refs/pr/1 --local-dir "$M/infinitetalk/chinese-wav2vec2-base"
  venv t2-neural-infinitetalk
  VIRTUAL_ENV="$V/t2-neural-infinitetalk" uv pip install -q $TORCH
  VIRTUAL_ENV="$V/t2-neural-infinitetalk" uv pip install -q "xformers==0.0.31.post1" --index-url https://download.pytorch.org/whl/cu128
  # diffusers rejects flash-attn > 2.8.0; community Windows wheel
  VIRTUAL_ENV="$V/t2-neural-infinitetalk" uv pip install -q \
    "https://github.com/kingbri1/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1%2Bcu128torch2.7.0cxx11abiFALSE-cp310-cp310-win_amd64.whl"
  grep -v "gradio\|dashscope" "$M/infinitetalk/repo/requirements.txt" > "$M/infinitetalk/req-win.txt"
  VIRTUAL_ENV="$V/t2-neural-infinitetalk" uv pip install -q -r "$M/infinitetalk/req-win.txt" "transformers==4.51.3" "diffusers==0.34.0" librosa soundfile \
    nvidia-ml-py "triton-windows<3.4" "misaki[en]" psutil
fi

# smoke inputs: each repo's own sample image (never a generated stand-in)
mkdir -p "$H/portraits/_smoke"
cp -n "$M/ditto/repo/example/image.png" "$H/portraits/_smoke/ditto_image.png" 2>/dev/null || true
cp -n "$M/ditto/repo/example/audio.wav" "$H/portraits/_smoke/ditto_audio.wav" 2>/dev/null || true
cp -n "$M/flashhead/repo/examples/girl.png" "$H/portraits/_smoke/flashhead_girl.png" 2>/dev/null || true
cp -n "$M/infinitetalk/repo/examples/single/ref_image.png" "$H/portraits/_smoke/infinitetalk_ref.png" 2>/dev/null || true
echo "t2-neural setup done"
