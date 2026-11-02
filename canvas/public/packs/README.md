# Bundled packs

`gg-demo` and `gg-forge` install on first boot from `index.json`. Rebuild them with the vault CLI (`integrate`, then `index`), never by hand: file names and the manifest name are content hashes.

Variant families: object entries carry `family` (the material with its digit and single-letter tokens removed, so `storage_barrel_1_dark` becomes `storage_barrel_dark`). `integrate` writes it on the object entries it mints. To rewrite a shipped manifest without touching its images, run `families` with the next version, then `index` (paths are relative to `packages/vault-cli`, where the script runs):

```
pnpm --filter @dnd/vault-cli cli families -p ../../canvas/public/packs/gg-demo --pack-version 0.1.2
pnpm --filter @dnd/vault-cli cli index -d ../../canvas/public/packs
```

The version bump is what makes returning browsers reinstall the pack. `gg-forge` has no families: its object entries are the cave band kit, not props.

Placeholders: `gg-forge:water-still-a-01` and `gg-forge:bank-grassy-01-a1` are procedural stand-ins made by the retired water placeholder script; nothing draws with them any more.

Path materials (placeholder): `gg-forge:road-dirt`, `road-cobble`, `trail-grass`, `planks` and `water` are procedural stand-ins made by `scripts/gen-path-placeholders.mjs`. Each is a set of `path` entries keyed `<material>-<piece>`: `strip` (4x1, loops left to right, required), `edge` (2x1, row 0 against the path, fading outward), `end` (1x1, the cap at a cut end, pointing +U), and for water `fill` (4x4, seamless) and `fall` (2x2). All carry the `placeholder` tag. Integrate the forge sets under the same set names and entry keys to replace them.
