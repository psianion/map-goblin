#!/bin/sh
# Stage 3 smalls rerun: 1x1 and half drift into invented paneling/garbage at d0.70
# (small canvas = too much model freedom). Anchor structure with lower denoise.
cd "D:/Labs/map-goblin/forge" || exit 1

run() { # len template src denoise seed wrapblend
  name="$1-d$4-s$5"
  [ -f "staging/stage3/$1/$name.png" ] && echo "skip $name (exists)" && return 0
  echo "=== $name ==="
  node run-job.mjs --template "templates/$2" --out "staging/stage3/$1/raw/$name.png" --denoise "$4" --seed "$5" || return 1
  node post.mjs --raw "staging/stage3/$1/raw/$name.png" --src "$3" --out "staging/stage3/$1/$name.png" --wrapblend "$6"
  node check.mjs --png "staging/stage3/$1/$name.png" --band 68 --bandy 66
}

C1="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_C_1x1.png"
HS="templates/fieldstone-half-src.png"

for d in 0.60 0.65; do
  for s in 22 33 44; do
    run 1x1 fieldstone-1x1-grey2.png "$C1" $d $s 40
  done
done
for d in 0.60 0.65; do
  for s in 22 33 44; do
    run half fieldstone-half-grey2.png "$HS" $d $s 24
  done
done
echo "smalls rerun complete"
