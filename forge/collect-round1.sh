#!/bin/sh
# Recover round 1: wait for all 8 outputs, then post+check each in submission order.
cd "D:/Labs/map-goblin/forge" || exit 1
SRC="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_A_3x1.png"

until [ "$(ls D:/ComfyUI/output/forge-wall_*.png 2>/dev/null | wc -l)" -ge 8 ]; do sleep 60; done
sleep 30  # let the final save settle

set -- grey-d0.55-s11 grey-d0.55-s22 grey-d0.65-s11 grey-d0.65-s22 grey-d0.75-s11 grey-d0.75-s22 edge-d0.85-s11 edge-d0.95-s11
i=1
mkdir -p staging/round1/raw
for name in "$@"; do
  n=$(printf '%05d' $i)
  cp "D:/ComfyUI/output/forge-wall_${n}_.png" "staging/round1/raw/$name.png" || exit 1
  node post.mjs --raw "staging/round1/raw/$name.png" --src "$SRC" --out "staging/round1/$name.png"
  node check.mjs --png "staging/round1/$name.png" --band 68 --bandy 66
  i=$((i+1))
done
rm D:/ComfyUI/output/forge-wall_*.png
node review.mjs --dir staging/round1 --src "$SRC"
echo "round 1 collected"
