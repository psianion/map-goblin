# Mac Generation Server — Setup Guide

Offload ComfyUI generation to the spare MacBook Air (16 GB, Apple Silicon) while this
Windows box keeps the whole pipeline brain (templates, post, check, gates, drivers).
Decision 2026-08-08: the Timber Palisade set finishes on the Windows box; this setup is
for the NEXT asset set.

## Why it's faster there

The GTX 1650's 4 GB can't hold the SDXL UNet even at fp8 — every step re-streams
offloaded weights over PCIe (33–46 s/it → 16–20 min per 28-step strip). A 16 GB Air holds
the whole model in unified memory at fp16 via Metal/MPS: ballpark 4–10 s/it at our strip
sizes → 2–5 min per strip, throttling ~20–30% on sustained batches (fanless).

**Disqualifier check first:** must be Apple Silicon (About This Mac → M1/M2). An Intel
Air is a non-starter.

## Mac setup (one-time)

```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
python3 -m venv .venv && source .venv/bin/activate
pip install torch torchvision torchaudio   # MPS is in the standard wheels
pip install -r requirements.txt
```

Copy the checkpoint from this box into the Mac:
`D:\ComfyUI\models\checkpoints\sd_xl_base_1.0.safetensors` (~6.9 GB)
→ `ComfyUI/models/checkpoints/` (USB or network copy).

Launch (no Windows-specific flags — `--disable-dynamic-vram` / fp8 exist for the 1650 +
aimdo hooks; fp16 fits in 16 GB unified):

```bash
caffeinate -i python main.py --listen 0.0.0.0
```

- `caffeinate -i` blocks idle sleep while the server runs — the #1 gotcha. Keep it
  plugged in; closed lid on battery still sleeps.
- Allow incoming connections when macOS prompts.

## Connection — Tailscale

Same tailnet, one env var. With MagicDNS the machine name works directly:

```bash
COMFY_URL=http://<mac-tailnet-name>:8188 bash run-<driver>.sh
```

- `--listen 0.0.0.0` covers the Tailscale interface.
- Bandwidth is a non-issue (~1–2 MB template up, similar down, 5 s polls); same-LAN
  peers connect directly, and even a DERP relay is fine.

## Windows-side patch required (run-job.mjs)

`run-job.mjs` assumes local ComfyUI: it copies templates into `D:/ComfyUI/input` and
collects/deletes results via the filesystem (`COMFY_DIR`). For a remote server it must
use the HTTP API instead — gate on `COMFY_URL` not being localhost so local behavior is
untouched:

- Template in: `POST {COMFY_URL}/upload/image` (multipart, field `image`, overwrite=true)
  instead of `fs.copyFileSync` into `input/`.
- Result out: `GET {COMFY_URL}/view?filename=...&subfolder=...&type=output` instead of
  reading `ComfyUI/output/` — write the response to `--out`.
- Cleanup: ComfyUI has no delete endpoint, so remote outputs accumulate in the Mac's
  `ComfyUI/output/`. The standing cleanup rule extends there: `rm ComfyUI/output/*` on
  the Mac after each gate.

~15 lines. Not applied yet — apply before first remote run, then smoke-test one
throwaway strip and record real s/it.

## Recipe caveats

- **Seeds/precision don't transfer.** MPS+fp16 will not reproduce CUDA+fp8 images from
  the same seed. Never migrate mid-sweep: a round's candidates must all come from one
  machine. Locked recipes carry over as settings (denoise/steps/cfg/sampler), but seed
  picks restart on the new backend.
- Machine gates (check.mjs etc.) don't care where pixels came from — unchanged.
- Throughput planning: budget the fanless throttle for batches (sustained ≈ 70–80% of
  first-strip speed).
