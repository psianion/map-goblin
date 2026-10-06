import { PackCard } from 'map-builder';

const noop = () => {};

// The canvas store's PackSummary is the one PackCard reads: name, version,
// sizeBytes and the optional `bundled` flag (NOT the core package's
// bundleSize/entryCount shape, which renders "NaN MB" and a blank title).
const demoPack = {
  packId: 'gg-demo',
  name: 'Good Goblin — Demo',
  version: '1.4.0',
  sizeBytes: 18_400_000,
  bundled: true,
  entryCount: 218,
  themes: ['dungeon', 'cave', 'forest'],
};

export function Installed() {
  return (
    <div className="w-[320px]">
      <PackCard pack={demoPack} onUninstall={noop} />
    </div>
  );
}

export function UpdateAvailable() {
  return (
    <div className="w-[320px]">
      <PackCard
        pack={demoPack}
        update={{ packId: 'gg-demo', currentVersion: '1.4.0', availableVersion: '1.5.0' }}
        onUninstall={noop}
        onUpdate={noop}
      />
    </div>
  );
}

export function ForgePack() {
  return (
    <div className="w-[320px]">
      <PackCard
        pack={{
          packId: 'gg-forge',
          name: 'Good Goblin — Forge',
          version: '0.9.2',
          sizeBytes: 6_200_000,
          bundled: false,
          entryCount: 64,
          themes: ['stone', 'timber'],
        }}
        onUninstall={noop}
      />
    </div>
  );
}
