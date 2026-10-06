#!/bin/sh
cd "D:/Labs/map-goblin/forge" || exit 1
SRC="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_B_2x1.png"
for s in 88 99 111; do
  name="2x1-s$s"
  [ -f "staging/stage3/2x1/$name.png" ] && continue
  echo "=== $name ==="
  node run-job.mjs --template "templates/fieldstone-2x1-grey2.png" --out "staging/stage3/2x1/raw/$name.png" --denoise 0.70 --seed "$s" || exit 1
  node post.mjs --raw "staging/stage3/2x1/raw/$name.png" --src "$SRC" --out "staging/stage3/2x1/$name.png" --wrapblend 64
  node check.mjs --png "staging/stage3/2x1/$name.png" --band 68 --bandy 66
done
echo "2x1 extras complete"
