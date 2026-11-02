# Bundled packs

`gg-demo` and `gg-forge` install on first boot from `index.json`. Rebuild them with the vault CLI (`integrate`, then `index`), never by hand: file names and the manifest name are content hashes.

Variant families: object entries carry `family` (the material with its digit and single-letter tokens removed, so `storage_barrel_1_dark` becomes `storage_barrel_dark`). `integrate` writes it on the object entries it mints. To rewrite a shipped manifest without touching its images, run `families` with the next version, then `index` (paths are relative to `packages/vault-cli`, where the script runs):

```
pnpm --filter @dnd/vault-cli cli families -p ../../canvas/public/packs/gg-demo --pack-version 0.1.2
pnpm --filter @dnd/vault-cli cli index -d ../../canvas/public/packs
```

The version bump is what makes returning browsers reinstall the pack. `gg-forge` has no families: its object entries are the cave band kit, not props.

Placeholders: `gg-forge:water-still-a-01` and `gg-forge:bank-grassy-01-a1` are procedural stand-ins made by the retired water placeholder script; nothing draws with them any more.

Path kits: `gg-forge:road-dirt`, `road-cobble`, `trail-grass`, `planks` and `water` are each a `kit` entry keyed `<set>-kit`, with no image of its own, whose `kit` manifest names the pieces the material is built from (`KitManifest` in packages/vault-engine/src/types.ts): a `fill` tile, `edge` units walked along the outline, `cross` planks, a `railPost` and `rope`, `band` straights, an `end` piece. Every key is another entry of the pack; the units are the round 4 objects under `GG_Paths_Props`. The dirt, cobble and trail fills (`<set>-fill`, 4x1) are the old strips standing in until a forge round paints seamless fills; `water-fill` (4x4) and `water-fall` (2x2) stay from the placeholders. `scripts/install-paths-round4.mjs` installs the round 4 art and then runs `scripts/migrate-path-kits.mjs`, which builds the kits and removes every strip, edge and end piece.
