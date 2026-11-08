// The prop card's custom rows: Transform (X, Y, W, H with the ratio lock, Angle, the two
// flips), the four Order buttons, Variant with Replace, and an imported picture's Image rows.

import { useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, FlipHorizontal2, FlipVertical2, Link2, Unlink2, type LucideIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import type { ZOrderOp } from '@dnd/core/src/store/propEdits';
import { familyMembers } from '@dnd/core/src/assets/packCatalog';
import { IconKeyButton, SecondaryButton, Seg, SettingRow, Tile, Input } from '@dnd/ui';
import { isBattlemapLayer } from '@/editor/models/layerSheetModel';
import { convertToTrace, lineUpPicture, moveToBattlemap } from '@/editor/models/battlemapActions';
import { PackThumbnailCanvas } from '@/editor/PackThumbnailCanvas';
import type { SettingProps } from '@/editor/registry/types';
import { orderSelectionNow, runSelectionVerb } from '@/shortcuts/defaultShortcuts';
import { openAssets } from '@/editor/families/design/openAssets';
import type { BoxValue } from './propModel';

/** A number typed in, landed on Enter or blur; Escape puts it back. */
function NumberInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const land = () => {
    const v = draft === null ? NaN : parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-3">
      {label}
      <Input
        aria-label={label}
        className="w-[60px] font-mono"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={land}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </label>
  );
}

/** Centre, size and angle, typed; the ratio lock keeps W and H together. */
export function TransformField({ value, onChange }: SettingProps<BoxValue>) {
  const [linked, setLinked] = useState(true);
  const ratio = value.w > 0 ? value.h / value.w : 1;
  const set = (patch: Partial<BoxValue>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-1.5">
      <SettingRow label="Position">
        <span className="flex gap-2">
          <NumberInput label="X" value={value.x} onCommit={(x) => set({ x })} />
          <NumberInput label="Y" value={value.y} onCommit={(y) => set({ y })} />
        </span>
      </SettingRow>
      <SettingRow label="Size">
        <span className="flex items-center gap-2">
          <NumberInput label="W" value={value.w} onCommit={(w) => w > 0 && set(linked ? { w, h: w * ratio } : { w })} />
          <NumberInput label="H" value={value.h} onCommit={(h) => h > 0 && set(linked ? { h, w: ratio > 0 ? h / ratio : h } : { h })} />
          <IconKeyButton
            size={26}
            icon={linked ? Link2 : Unlink2}
            label="Keep W:H ratio"
            active={linked}
            onClick={() => setLinked((l) => !l)}
          />
        </span>
      </SettingRow>
      <SettingRow label="Angle">
        <span className="flex items-center gap-1">
          <NumberInput label="Degrees" value={value.angle} onCommit={(angle) => set({ angle })} />
          <IconKeyButton size={26} icon={FlipHorizontal2} label="Flip horizontal" onClick={() => runSelectionVerb('flipH')} />
          <IconKeyButton size={26} icon={FlipVertical2} label="Flip vertical" onClick={() => runSelectionVerb('flipV')} />
        </span>
      </SettingRow>
    </div>
  );
}

const ORDER: { op: ZOrderOp; label: string; icon: LucideIcon }[] = [
  { op: 'back', label: 'Send to back', icon: ArrowDownToLine },
  { op: 'backward', label: 'Send backward', icon: ArrowDown },
  { op: 'forward', label: 'Bring forward', icon: ArrowUp },
  { op: 'front', label: 'Bring to front', icon: ArrowUpToLine },
];

/** The four order steps within the layer: to back, backward, forward, to front. */
export function OrderField({ def }: SettingProps<null>) {
  return (
    <SettingRow label={def.label}>
      <span className="flex gap-[2px]">
        {ORDER.map((o) => (
          <IconKeyButton key={o.op} size={26} icon={o.icon} label={o.label} onClick={() => orderSelectionNow(o.op)} />
        ))}
      </span>
    </SettingRow>
  );
}

/** The prop's family, its member ringed; a pick swaps it in, Replace opens the library to swap in anything. */
export function VariantField({ value, onChange }: SettingProps<string>) {
  // Families and thumbnails arrive with the packs, after boot.
  useStore((s) => s.packs.installedPacks);
  const ids = useStore(useShallow((s) => s.selection.selectedIds));
  const members = value ? familyMembers(value) : [];
  return (
    <div className="flex flex-col gap-1.5">
      {members.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <Tile key={m.id} name={m.label} aria-label={m.label} active={m.id === value} onClick={() => m.id !== value && onChange(m.id)}>
              <PackThumbnailCanvas textureId={m.id} />
            </Tile>
          ))}
        </div>
      ) : (
        <span className="text-[11px] text-text-3">No other variants</span>
      )}
      <SecondaryButton
        className="self-start"
        onClick={() => {
          // The library opens on props; the next pick there replaces these.
          useStore.getState().setPropReplaceIds([...ids]);
          openAssets('object');
        }}
      >
        Replace…
      </SecondaryButton>
    </div>
  );
}

const USE_AS_OPTIONS = [
  { value: 'battlemap', label: 'Battlemap' },
  { value: 'trace', label: 'Trace' },
];

/**
 * An imported picture's Image rows: Line up grid, and Use as. Battlemap moves it onto a
 * locked Battlemap layer at the map origin and opens the line-up; Trace makes it a trace
 * layer in the same place. `value` is the picture's id.
 */
export function ImageField({ value }: SettingProps<string>) {
  const onBattlemap = useStore((s) => {
    const layer = s.layers.find((l) => l.type === 'dungeon' && l.children.some((c) => c.id === value));
    return !!layer && isBattlemapLayer(layer);
  });
  return (
    <div className="flex flex-col gap-px">
      <SettingRow label="Grid">
        <SecondaryButton data-testid="card-image-lineup" onClick={() => void lineUpPicture(value)}>
          Line up grid
        </SecondaryButton>
      </SettingRow>
      <SettingRow label="Use as">
        <Seg
          aria-label="Use as"
          options={USE_AS_OPTIONS}
          value={onBattlemap ? 'battlemap' : ''}
          onValueChange={(v) => (v === 'trace' ? convertToTrace(value) : moveToBattlemap(value))}
        />
      </SettingRow>
    </div>
  );
}
