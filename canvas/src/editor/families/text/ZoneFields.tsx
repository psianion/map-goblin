// The zone card's custom rows: its name, where it sits (X and Y) and how big (R, or W and
// H), and the Triggers row with More and Prep overview.

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import type { ZoneShape } from '@/store/types';
import { InputRow, SecondaryButton, SettingRow, Input } from '@dnd/ui';
import type { SettingProps } from '@/editor/registry/types';
import { useShell } from '@/editor/shell/shellStore';

/** Typed, landed on Enter or blur; Escape puts it back. */
function Typed({ label, value, onCommit, width = 'w-[60px]' }: { label: string; value: string; onCommit: (v: string) => void; width?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-3">
      {label}
      <Input
        aria-label={label}
        className={`${width} font-mono`}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

/** The zone's name. Empty keeps the old one. */
export function ZoneNameField({ def, value, onChange }: SettingProps<string>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <InputRow
      label={def.label}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onChange(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number) => String(Math.round(n * 100) / 100);

/** X and Y (the corner of a rect, the centre otherwise), then R or W and H. */
export function ZonePlaceField({ value, onChange }: SettingProps<ZoneShape>) {
  const pos = value.kind === 'rect' ? { x: value.x, y: value.y } : value.position;
  const at = (axis: 'x' | 'y') => (raw: string) => {
    const v = num(raw);
    if (v === null) return;
    onChange(value.kind === 'rect' ? { ...value, [axis]: v } : { ...value, position: { ...value.position, [axis]: v } });
  };
  const positive = (raw: string, fn: (v: number) => ZoneShape) => {
    const v = num(raw);
    if (v !== null && v > 0) onChange(fn(v));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <SettingRow label="Place">
        <span className="flex gap-2">
          <Typed label="X" value={r2(pos.x)} onCommit={at('x')} />
          <Typed label="Y" value={r2(pos.y)} onCommit={at('y')} />
        </span>
      </SettingRow>
      {value.kind === 'circle' && (
        <SettingRow label="Size">
          <Typed label="R" value={r2(value.radius)} onCommit={(raw) => positive(raw, (radius) => ({ ...value, radius }))} />
        </SettingRow>
      )}
      {value.kind === 'rect' && (
        <SettingRow label="Size">
          <span className="flex gap-2">
            <Typed label="W" value={r2(value.width)} onCommit={(raw) => positive(raw, (width) => ({ ...value, width }))} />
            <Typed label="H" value={r2(value.height)} onCommit={(raw) => positive(raw, (height) => ({ ...value, height }))} />
          </span>
        </SettingRow>
      )}
    </div>
  );
}

/** The Zone tool's panel extra: the map's Prep overview, reachable with nothing picked. */
export function ZonePanel() {
  return (
    <div className="px-3 pb-2.5">
      <SecondaryButton onClick={() => useShell.getState().openSheet('prep')}>Prep overview</SecondaryButton>
    </div>
  );
}

/** How many triggers watch this zone, More for its sheet, Prep overview for the map's. */
export function ZoneTriggersField({ def, value }: SettingProps<number>) {
  const id = useStore(useShallow((s) => s.selection.selectedIds[0] ?? ''));
  const open = useShell((s) => s.openSheet);
  return (
    <div className="flex flex-col gap-1.5">
      <SettingRow label={def.label}>
        <span className="font-mono text-[11px] text-text tabular-nums">{value}</span>
      </SettingRow>
      <span className="flex gap-1.5">
        <SecondaryButton onClick={() => open({ kind: 'zone', target: id })}>More…</SecondaryButton>
        <SecondaryButton onClick={() => open('prep')}>Prep overview</SecondaryButton>
      </span>
    </div>
  );
}
