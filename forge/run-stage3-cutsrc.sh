#!/bin/sh
cd "D:/Labs/map-goblin/forge" || exit 1
SRC="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_A_3x1.png"
for s in 222 333; do
  name="cutsrc-s$s"
  [ -f "staging/stage3/cutsrc/$name.png" ] && continue
  mkdir -p staging/stage3/cutsrc/raw
  echo "=== $name ==="
  node run-job.mjs --template "templates/fieldstone-3x1-grey2.png" --out "staging/stage3/cutsrc/raw/$name.png" --denoise 0.70 --seed "$s" || exit 1
  node post.mjs --raw "staging/stage3/cutsrc/raw/$name.png" --src "$SRC" --out "staging/stage3/cutsrc/$name.png" --wrapblend 80
  node check.mjs --png "staging/stage3/cutsrc/$name.png" --band 68 --bandy 66
done
echo "cutsrc complete"
