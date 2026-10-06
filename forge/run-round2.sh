#!/bin/sh
# Round 2: grey lineage primary (structure-faithful), template v2, seam wrap-blend in post.
cd "D:/Labs/map-goblin/forge" || exit 1
SRC="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_A_3x1.png"

echo "waiting for ComfyUI..."
i=0
until curl -s -o /dev/null http://127.0.0.1:8188/system_stats; do
  i=$((i+1)); [ $i -gt 60 ] && echo "ComfyUI never came up" && exit 1
  sleep 5
done

mkdir -p staging/round2/raw
run() { # denoise seed
  name="grey2-d$1-s$2"
  echo "=== $name ==="
  node run-job.mjs --template "templates/fieldstone-3x1-grey2.png" --out "staging/round2/raw/$name.png" --denoise "$1" --seed "$2" || return 1
  node post.mjs --raw "staging/round2/raw/$name.png" --src "$SRC" --out "staging/round2/$name.png" --wrapblend 80
  node check.mjs --png "staging/round2/$name.png" --band 68 --bandy 66
}

run 0.60 11
run 0.60 22
run 0.65 11
run 0.65 22
run 0.70 11
run 0.70 22
node review.mjs --dir staging/round2 --src "$SRC"
echo "round 2 sweep complete"
