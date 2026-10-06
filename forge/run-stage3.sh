#!/bin/sh
# Stage 3: locked recipe (grey2 template, d0.70, prompt v3) across all 4 Fieldstone
# straight lengths x 6 seeds; best 3 per length become variants A/B/C at the gate.
cd "D:/Labs/map-goblin/forge" || exit 1
SRCDIR="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A"

echo "waiting for ComfyUI..."
i=0
until curl -s -o /dev/null http://127.0.0.1:8188/system_stats; do
  i=$((i+1)); [ $i -gt 60 ] && echo "ComfyUI never came up" && exit 1
  sleep 5
done

run() { # len template src seed wrapblend
  name="$1-s$4"
  [ -f "staging/stage3/$1/$name.png" ] && echo "skip $name (exists)" && return 0
  mkdir -p "staging/stage3/$1/raw"
  echo "=== $name ==="
  node run-job.mjs --template "templates/$2" --out "staging/stage3/$1/raw/$name.png" --denoise 0.70 --seed "$4" || return 1
  node post.mjs --raw "staging/stage3/$1/raw/$name.png" --src "$3" --out "staging/stage3/$1/$name.png" --wrapblend "$5"
  node check.mjs --png "staging/stage3/$1/$name.png" --band 68 --bandy 66
}

# 3x1: seed 22 is the locked round-2 winner, copied in by the launcher
for s in 33 44 55 66 77; do
  run 3x1 fieldstone-3x1-grey2.png "$SRCDIR/Wall_Stone_Earthy_A_Straight_A_3x1.png" $s 80
done
for s in 22 33 44 55 66 77; do
  run 2x1 fieldstone-2x1-grey2.png "$SRCDIR/Wall_Stone_Earthy_A_Straight_B_2x1.png" $s 64
done
for s in 22 33 44 55 66 77; do
  run 1x1 fieldstone-1x1-grey2.png "$SRCDIR/Wall_Stone_Earthy_A_Straight_C_1x1.png" $s 40
done
# half runs against the 100x200 crop; re-embed to the 200x200 tile happens at packaging
for s in 22 33 44 55 66 77; do
  run half fieldstone-half-grey2.png "templates/fieldstone-half-src.png" $s 24
done

node review.mjs --dir staging/stage3/3x1 --src "$SRCDIR/Wall_Stone_Earthy_A_Straight_A_3x1.png"
node review.mjs --dir staging/stage3/2x1 --src "$SRCDIR/Wall_Stone_Earthy_A_Straight_B_2x1.png"
node review.mjs --dir staging/stage3/1x1 --src "$SRCDIR/Wall_Stone_Earthy_A_Straight_C_1x1.png"
node review.mjs --dir staging/stage3/half --src "templates/fieldstone-half-src.png"
echo "stage 3 sweep complete"
