#!/usr/bin/env bash
# P2 recipe confirmation for Timber Palisade: locked fieldstone recipe (grey2 template,
# 28 steps dpmpp_2m/karras cfg 6.5, wrapblend 80) micro-swept d{0.65,0.70} x s{22,555}.
set -u
cd "$(dirname "$0")"
T=templates/palisade-3x1-grey2.png
SRC="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Wood_A/Wall_Wood_Ashen_A_Straight_A_3x1.png"
S=staging/palisade-p2
mkdir -p "$S/raw"
P="$(cat prompt-palisade.txt)"
N="$(cat negative-palisade.txt)"

until curl -s http://127.0.0.1:8188/system_stats >/dev/null; do
  echo "waiting for ComfyUI..."; sleep 15
done

for d in 0.65 0.70; do
  for s in 22 555; do
    id="grey2-d${d}-s${s}"
    [ -f "$S/$id.png" ] && { echo "skip $id (done)"; continue; }
    node run-job.mjs --template "$T" --out "$S/raw/$id.png" --denoise "$d" --seed "$s" --prompt "$P" --negative "$N" || { echo "JOB FAILED $id"; continue; }
    node post.mjs --raw "$S/raw/$id.png" --src "$SRC" --out "$S/$id.png" --wrapblend 80
    node check.mjs --png "$S/$id.png" --band 44 --bandy 78 || true
  done
done
echo "P2 SWEEP DONE"
