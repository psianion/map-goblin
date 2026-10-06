#!/bin/sh
cd "D:/Labs/map-goblin/forge" || exit 1
SRC3="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Stone_A/Wall_Stone_Earthy_A_Straight_A_3x1.png"
for s in 555 666; do
  name="cutsrc2-s$s"
  [ -f "staging/stage4/cutsrc/$name.png" ] && continue
  node run-job.mjs --template templates/fieldstone-3x1-grey2.png --out "staging/stage4/cutsrc/raw/$name.png" --denoise 0.70 --seed "$s" || exit 1
  node post.mjs --raw "staging/stage4/cutsrc/raw/$name.png" --src "$SRC3" --out "staging/stage4/cutsrc/$name.png" --wrapblend 80
  node check.mjs --png "staging/stage4/cutsrc/$name.png" --band 68 --bandy 66
done
echo "cutsrc2 strips done"
