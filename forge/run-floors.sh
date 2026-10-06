#!/bin/sh
# Floor batch v1 drafts. One draft per family; variants come after the style is signed off.
#
#   sh run-floors.sh              # all six
#   sh run-floors.sh stone-dressed  # just one, for locking the recipe
#
# ~25-30 min per tile on this box (1024x1024, 4GB card). Six is roughly three hours.
cd "D:/Labs/map-goblin/forge" || exit 1
OUT="staging/floors-v1"
mkdir -p "$OUT/raw"

i=0
until node -e "fetch('http://127.0.0.1:8188/system_stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i+1)); [ $i -gt 60 ] && echo "ComfyUI never came up" && exit 1
  sleep 5
done
echo "ComfyUI is up"

# family denoise negative band
# denoise: structured surfaces keep their layout at 0.70; the two featureless browns
#   (earth, grass) have no structure worth keeping, so they run hotter to invent some.
# band: how far the seam heal reaches in. Planks are strongly directional and ghost
#   badly under a wide blend, so they get a narrow one.
FAILED=""

run() {
  slug="$1"; denoise="$2"; neg="$3"; band="$4"
  echo "=== $slug (denoise $denoise, heal band $band) ==="
  if ! node run-job.mjs \
    --template "templates/floor-$slug-src.png" \
    --out "$OUT/raw/$slug.png" \
    --prompt "$(cat prompt-floor-$slug.txt)" \
    --negative "$(cat negative-floor-$neg.txt)" \
    --denoise "$denoise" --seed 11 --steps 28 --cfg 6.5 --maxwait 55
  then
    echo "!!! $slug FAILED to generate"
    FAILED="$FAILED $slug"
    return 1
  fi
  node seamless.mjs --in "$OUT/raw/$slug.png" --out "$OUT/$slug.png" --band "$band" || {
    echo "!!! $slug failed seam heal"; FAILED="$FAILED $slug"; return 1;
  }
}

if [ -n "$1" ]; then
  case "$1" in
    stone-dressed) run stone-dressed 0.70 grey  0.5 ;;
    cave-rock)     run cave-rock     0.70 grey  0.5 ;;
    cobble)        run cobble        0.70 grey  0.5 ;;
    packed-earth)  run packed-earth  0.85 color 0.5 ;;
    grass)         run grass         0.85 color 0.5 ;;
    plank)         run plank         0.65 color 0.3 ;;
    *) echo "unknown family: $1"; exit 1 ;;
  esac
else
  run stone-dressed 0.70 grey  0.5
  run cave-rock     0.70 grey  0.5
  run cobble        0.70 grey  0.5
  run packed-earth  0.85 color 0.5
  run grass         0.85 color 0.5
  run plank         0.65 color 0.3
fi
# A batch that lost tiles is not a batch that completed. The first version of this script
# printed "complete" unconditionally, so a crashed generation still read as success.
if [ -n "$FAILED" ]; then
  echo "floor batch INCOMPLETE — failed:$FAILED"
  exit 1
fi
echo "floor batch complete -> $OUT"
