import { Mountain, SquareDashed } from 'lucide-react';
import { Caption, IconKeyButton, Kbd } from '@dnd/ui';
import { Section, type GalleryTheme } from './parts';

function Role({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <span className="font-mono text-[10px] text-text-3">{name}</span>
      <span>{children}</span>
    </>
  );
}

function TypeSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section
      id="type"
      title="Type"
      small="IBM Plex Sans, IBM Plex Mono"
      theme={theme}
      rules="Sans for words, Mono for numbers, keys, times and ids. Captions are 10px, 500, uppercase, 0.04em tracking. Nothing on the chrome is larger than 13px. Tabular numerals everywhere a number can change width."
    >
      <div className="grid grid-cols-[170px_1fr] items-baseline gap-x-4 gap-y-2">
        <Role name="title · 13 / 500">
          <span className="text-[13px] font-medium text-text">Warren of the Pale Moth</span>
        </Role>
        <Role name="body · 12 / 400">
          <span className="text-[12px] text-text">Stay inside floors</span>
        </Role>
        <Role name="label · 12 / 400 · text-2">
          <span className="text-[12px] text-text-2">Snap to grid</span>
        </Role>
        <Role name="control · 11 / 400">
          <span className="text-[11px] text-text-2">Soft · Hard · Closed · Open · Locked</span>
        </Role>
        <Role name="caption · 10 / 500 · caps">
          <Caption className="inline">Placement</Caption>
        </Role>
        <Role name="tile name · 10 / 400 · text-2">
          <span className="text-[10px] text-text-2">Stone floor</span>
        </Role>
        <Role name="mono value · 11">
          <span className="font-mono text-[11px] text-text tabular-nums">16 sq · 40% · 120° · 6 × 6</span>
        </Role>
        <Role name="mono meta · 10 · text-3">
          <span className="font-mono text-[10px] text-text-3">saved 14:32 · L2 Cellars</span>
        </Role>
        <Role name="key · 8 or 9 · mono">
          <span className="inline-flex items-center gap-1">
            <IconKeyButton icon={SquareDashed} label="Floor" shortcut="F" active />
            <IconKeyButton size={36} icon={Mountain} label="Terrain" shortcut="T" active />
          </span>
        </Role>
        <Role name="keycap · 10 · mono">
          <span className="inline-flex gap-1">
            <Kbd>Enter</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>[</Kbd>
            <Kbd>]</Kbd>
          </span>
        </Role>
      </div>
    </Section>
  );
}

export { TypeSection };
