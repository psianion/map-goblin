#!/bin/sh
# Stage 3 top-up: extra seeds for 1x1 and half, which failed the seed lottery.
cd "D:/Labs/map-goblin/forge" || exit 1

run() { # len template src seed wrapblend
  name="$1-s$4"
  [ -f "staging/stage3/$1/$name.png" ] && echo "skip $name (exists)" && return 0
  echo "=== $name ==="
  node run-job.mjs --template "templates/$2" --out "staging/stage3/$1/raw/$name.png" --denoise 0.70 --seed "$4" || return 1
  node post.mjs --raw "staging/stage3/$1/raw/$name.png" --src "$3" --out "staging/stage3/$1/$name.png" --wrapblend "$5"
  node check.mjs --png "staging/stage3/$1/$name.png" --band 68 --bandy 66
}

for s in 88 99 111 222 333 444; do
  run 1x1 fieldstone-1x1-grey2.png "D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_C_1x1.png" $s 40
done
for s in 88 99 111 222 333 444; do
  run half fieldstone-half-grey2.png "templates/fieldstone-half-src.png" $s 24
done
echo "top-up complete"
