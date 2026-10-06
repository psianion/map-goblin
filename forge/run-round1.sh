#!/bin/sh
# Round 1 sweep: Fieldstone Straight 3x1 contract trial.
cd "D:/Labs/map-goblin/forge" || exit 1
SRC="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_A_3x1.png"

echo "waiting for ComfyUI..."
i=0
until curl -s -o /dev/null http://127.0.0.1:8188/system_stats; do
  i=$((i+1)); [ $i -gt 60 ] && echo "ComfyUI never came up" && exit 1
  sleep 5
done
echo "ComfyUI is up"

run() { # mode denoise seed
  name="$1-d$2-s$3"
  echo "=== $name ==="
  node run-job.mjs --template "templates/fieldstone-3x1-$1.png" --out "staging/round1/raw/$name.png" --denoise "$2" --seed "$3" || return 1
  node post.mjs --raw "staging/round1/raw/$name.png" --src "$SRC" --out "staging/round1/$name.png"
  node check.mjs --png "staging/round1/$name.png" --band 68 --bandy 66
}

run grey 0.55 11
run grey 0.55 22
run grey 0.65 11
run grey 0.65 22
run grey 0.75 11
run grey 0.75 22
run edge 0.85 11
run edge 0.95 11
echo "round 1 sweep complete"
