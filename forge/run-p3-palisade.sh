#!/bin/sh
# Stage P3: locked recipe (grey2 template, d0.70, palisade prompt) x 6 seeds,
# 3x1 ONLY — the 44px band is thinner than fieldstone's 68px, so 2x1/1x1/half
# get no native attempts at all (fieldstone at least tried them; palisade
# skips straight to cuts). Those three lengths are CUT from the two fresh
# cutsrc strips (run-p3-cutsrc-palisade.sh must run first) via cut-piece.mjs —
# cuts don't need wrapblend (they inherit the cutsrc strip's own seamless
# texture, wrapblend already baked in at cutsrc generation); only the native
# 3x1 sweep needs it, by cut width (80, same as fieldstone's 3x1).
cd "D:/Labs/map-goblin/forge" || exit 1
SRCDIR="D:/Labs/test-asset-sets/Walls_and_Curbs/Wall_Wood_A"
S=staging/palisade-s3
P="$(cat prompt-palisade.txt)"
N="$(cat negative-palisade.txt)"

echo "waiting for ComfyUI..."
i=0
until curl -s -o /dev/null http://127.0.0.1:8188/system_stats; do
  i=$((i+1)); [ $i -gt 60 ] && echo "ComfyUI never came up" && exit 1
  sleep 5
done

run() { # seed
  name="3x1-s$1"
  [ -f "$S/3x1/$name.png" ] && echo "skip $name (exists)" && return 0
  mkdir -p "$S/3x1/raw"
  echo "=== $name ==="
  # P2's approved d0.70-s22 raw is copied in by the launcher — regenerate only missing raws
  [ -f "$S/3x1/raw/$name.png" ] || node run-job.mjs --template "templates/palisade-3x1-grey2.png" --out "$S/3x1/raw/$name.png" --denoise 0.70 --seed "$1" --prompt "$P" --negative "$N" || return 1
  # ink weight varies per seed (P2: 0-2 erosion passes needed) — escalate until the gate passes
  for t in 0 1 2; do
    node post.mjs --raw "$S/3x1/raw/$name.png" --src "$SRCDIR/Wall_Wood_Ashen_A_Straight_A_3x1.png" --out "$S/3x1/$name.png" --wrapblend 80 --thinink "$t"
    node check.mjs --png "$S/3x1/$name.png" --band 44 --bandy 78
    grep -q '"pass": true' "$S/3x1/$name.json" && echo "$name locked at thinink=$t" && return 0
  done
  echo "$name FAILED at all thinink levels (leaving thinink=2 output for eyeball)"
}
for s in 22 33 44 66 77 88; do run "$s"; done
node review.mjs --dir "$S/3x1" --src "$SRCDIR/Wall_Wood_Ashen_A_Straight_A_3x1.png"

# 2x1 / 1x1 / half cuts happen AFTER this sweep, by hand: the --x windows must
# be eyeballed against the cutsrc plank grain so no cut lands mid-butt-joint
# and leaves a sliver (palisade-plan.md caveat — the machine gate can't see
# that style drift). Cut invocations live in run-p3-cuts-palisade.sh once the
# windows are picked.

echo "P3 sweep complete"
