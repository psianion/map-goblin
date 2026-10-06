#!/bin/sh
# Palisade cutsrc: 2 fresh full-length strips (not the 3x1 sweep winners) that
# 2x1/1x1/half get CUT from (run-p3-palisade.sh) — avoids texture repeats
# between the straight set and the cut pieces at the table. These same two
# strips are reused as compose-pad-palisade.mjs's arm texture (S555/S777) —
# one cutsrc round serves both jobs, unlike fieldstone's separate stage3
# cutsrc (straights) + stage4 cutsrc2 (pad arms) rounds.
cd "D:/Labs/map-goblin/forge" || exit 1
SRCDIR="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Wood_A"
SRC="$SRCDIR/Wall_Wood_Ashen_A_Straight_A_3x1.png"
S=staging/palisade-s3
mkdir -p "$S/raw"
P="$(cat prompt-palisade.txt)"
N="$(cat negative-palisade.txt)"

echo "waiting for ComfyUI..."
i=0
until curl -s -o /dev/null http://127.0.0.1:8188/system_stats; do
  i=$((i+1)); [ $i -gt 60 ] && echo "ComfyUI never came up" && exit 1
  sleep 5
done

# seeds 99/111 — NOT 555/777: s555 proved a dud paint seed at P2, don't reuse it
for s in 99 111; do
  name="cutsrc-s$s"
  [ -f "$S/$name.png" ] && echo "skip $name (exists)" && continue
  echo "=== $name ==="
  node run-job.mjs --template "templates/palisade-3x1-grey2.png" --out "$S/raw/$name.png" --denoise 0.70 --seed "$s" --prompt "$P" --negative "$N" || exit 1
  for t in 0 1 2; do
    node post.mjs --raw "$S/raw/$name.png" --src "$SRC" --out "$S/$name.png" --wrapblend 80 --thinink "$t"
    node check.mjs --png "$S/$name.png" --band 44 --bandy 78
    grep -q '"pass": true' "$S/$name.json" && echo "$name locked at thinink=$t" && break
  done
done
echo "cutsrc complete"
