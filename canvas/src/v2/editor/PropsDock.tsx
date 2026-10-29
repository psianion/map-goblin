import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Dices, MoreHorizontal, Plus, SprayCan, Stamp } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import type { ScatterBrushSettings } from '@/store/types';
import { MAX_SCATTER_TINTS, PROPS_RANGES } from '@dnd/core/src/store/slices/tools';
import { familyPosition, siblingOf } from '@dnd/core/src/assets/packCatalog';
import { cn } from '@/lib/utils';
import { ColorCtl, Ctl, DockPopover, RangeInput, Seg, Slider, Switch } from './controls';
import { NumBox } from './PropCards';
import { degToRad, radToDeg } from './selectionModel';
import './props.css';

/*
 * The Props tab's settings (Stamp and Scatter boards): the mode, the few controls a DM
 * reaches for while placing, and the rest behind "⋯". Every control writes the brush
 * settings, which the tool reads, so the dock and the wheel/keys on the canvas agree.
 */

const set = (patch: Partial<ScatterBrushSettings>) => useStore.getState().updateScatterBrushSettings(patch);

const fixed = (n: number) => (v: number) => v.toFixed(n);
const deg = (rad: number) => Math.round(radToDeg(rad)) % 360;

/** The scale range's span: a scattered prop between a third and twice its art size. */
export const SCATTER_SCALE_SPAN = { min: 0.3, max: 2, step: 0.05 } as const;
/** How far apart scattered props keep, in cells. */
export const SCATTER_SPACING_SPAN = { min: 0.2, max: 2, step: 0.1 } as const;
/**
 * The colours a tint added to the pool starts as, greys to earth browns: each new one takes
 * the first not already in the pool, so two added tints never match. The picker opens on it.
 */
export const SCATTER_TINT_PALETTE = ['#a39a8c', '#8c968a', '#99909a', '#8f8a82', '#a0806c', '#b3a487'] as const;

/** The first palette colour the pool does not hold yet. */
function nextTint(tints: readonly string[]): string {
  const used = new Set(tints.map((t) => t.toLowerCase()));
  return SCATTER_TINT_PALETTE.find((c) => !used.has(c)) ?? SCATTER_TINT_PALETTE[tints.length % SCATTER_TINT_PALETTE.length];
}

/** The Scale track's width, px: wide enough to set 0.25 to 4 by hand. */
const SCALE_TRACK_PX = 120;

/** One row of the "⋯" card: label left, control right. */
function PopRow({ label, children, value }: { label: string; children: ReactNode; value?: string }) {
  return (
    <div className="v2-ppop__row">
      <span className="v2-ppop__lbl">{label}</span>
      {children}
      {value !== undefined && <span className="v2-ppop__val v2-num">{value}</span>}
    </div>
  );
}

function PopSwitch({ label, checked, onChange, aria }: { label: string; checked: boolean; onChange: (v: boolean) => void; aria?: string }) {
  return (
    <div className="v2-ppop__row">
      <span className="v2-ppop__lbl v2-ppop__lbl--grow">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={aria ?? label}
        className={cn('v2-switch', checked && 'v2-switch--on')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

/** Two thumbs on one track, for the card's ranges. */
function PopRange({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: readonly [number, number];
  min: number;
  max: number;
  step: number;
  format: (lo: number, hi: number) => string;
  onChange: (v: [number, number]) => void;
}) {
  const [lo, hi] = value;
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <PopRow label={label} value={format(lo, hi)}>
      <span className="v2-pair v2-ppop__track" role="group" aria-label={label} style={{ '--v2-lo': pct(lo), '--v2-hi': pct(hi) } as CSSProperties}>
        <input
          type="range"
          className="v2-range"
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label={`${label}, smallest`}
          onChange={(e) => onChange([Math.min(parseFloat(e.target.value), hi), hi])}
        />
        <input
          type="range"
          className="v2-range"
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label={`${label}, largest`}
          onChange={(e) => onChange([lo, Math.max(parseFloat(e.target.value), lo)])}
        />
      </span>
    </PopRow>
  );
}

/** The "⋯" button and its card, inside the settings column. */
function More({ label, tip, children }: { label: string; tip: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="v2-settings__more">
      <button
        type="button"
        className={cn('v2-ib', open && 'v2-ib--on')}
        aria-label={tip}
        aria-expanded={open}
        data-tip={label}
        data-testid="v2-props-more"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={15} strokeWidth={1.75} />
      </button>
      <DockPopover open={open} onClose={() => setOpen(false)} className="v2-pop--settings v2-ppop" label={`${label} settings`}>
        <p className="v2-pop__title">{label}</p>
        {children}
      </DockPopover>
    </span>
  );
}

/** "‹ 2/7 ›": the stamp's place in its family; the arrows step it, as Shift+wheel does. */
function Variant({ assetId }: { assetId: string | undefined }) {
  // The families arrive with the packs, after boot; re-read when the pack list moves.
  useStore((s) => s.packs.installedPacks);
  const { index, count } = assetId ? familyPosition(assetId) : { index: 0, count: 0 };
  const step = (dir: 1 | -1) => {
    if (assetId) set({ assetIds: [siblingOf(assetId, dir)] });
  };
  const alone = count < 2;
  return (
    <Ctl label="Variant" wide>
      <span className="v2-stepper" data-testid="v2-props-variant">
        <button type="button" aria-label="Previous variant (Shift+wheel)" disabled={alone} onClick={() => step(-1)}>
          <ChevronLeft size={10} />
        </button>
        <span className="v2-num">{count > 0 ? `${index}/${count}` : '—'}</span>
        <button type="button" aria-label="Next variant (Shift+wheel)" disabled={alone} onClick={() => step(1)}>
          <ChevronRight size={10} />
        </button>
      </span>
    </Ctl>
  );
}

function StampSettings({ brush }: { brush: ScatterBrushSettings }) {
  const keepPlacing = useStore((s) => s.tools.settings.continuousPlacement);
  const angle = deg(brush.stampRotation);
  return (
    <>
      <Ctl label="Scale" width={SCALE_TRACK_PX + 6 + 60}>
        <span className="v2-pscale">
          <RangeInput
            label="Scale"
            value={brush.stampScale}
            {...PROPS_RANGES.stampScale}
            onChange={(v) => set({ stampScale: v })}
          />
          <NumBox
            label="×"
            title="Scale, times the art size"
            value={brush.stampScale}
            format={fixed(2)}
            className="v2-pnum--dock"
            onCommit={(v) => set({ stampScale: v })}
          />
        </span>
      </Ctl>
      <Ctl label="Angle" wide>
        <button
          type="button"
          className="v2-achip v2-num"
          aria-label={`Angle ${angle}°, click resets to 0°`}
          data-tip="Wheel turns it 15°; click resets"
          onClick={() => set({ stampRotation: 0 })}
        >
          {angle}°
        </button>
      </Ctl>
      <Switch label="Mirror" checked={brush.stampFlipX} onChange={(v) => set({ stampFlipX: v })} />
      <Variant assetId={brush.assetIds[0]} />
      <More label="Stamp" tip="More: Keep placing, Vary each stamp, Place under">
        <PopSwitch
          label="Keep placing"
          checked={keepPlacing}
          onChange={(v) => useStore.getState().updateToolSettings({ continuousPlacement: v })}
        />
        <PopSwitch label="Vary each stamp" checked={brush.stampVary} onChange={(v) => set({ stampVary: v })} />
        <PopSwitch
          label="Place under"
          aria="Place under existing props"
          checked={brush.placeUnder}
          onChange={(v) => set({ placeUnder: v })}
        />
      </More>
    </>
  );
}

function Tints({ tints }: { tints: string[] }) {
  const write = (next: string[]) => set({ tints: next });
  return (
    <>
      <div className="v2-ppop__row">
        <span className="v2-ppop__lbl">Tints</span>
        <span className="v2-rquiet">
          {tints.length} of {MAX_SCATTER_TINTS}
        </span>
        <button type="button" className="v2-link v2-ppop__end" disabled={tints.length === 0} onClick={() => write([])}>
          Clear
        </button>
      </div>
      <div className="v2-ppop__row v2-ptints">
        {tints.map((c, i) => (
          <ColorCtl
            key={i}
            label={`Tint ${i + 1}`}
            value={c}
            placement="beside"
            onChange={(next) => write(tints.map((t, j) => (j === i ? next : t)))}
          />
        ))}
        {tints.length < MAX_SCATTER_TINTS && (
          <button type="button" className="v2-color v2-ptints__add" aria-label="Add a tint" onClick={() => write([...tints, nextTint(tints)])}>
            <Plus size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </>
  );
}

function ScatterSettings({ brush }: { brush: ScatterBrushSettings }) {
  const [lo, hi] = brush.rotationRange;
  return (
    <>
      <Slider
        label="Radius"
        width={64}
        value={brush.brushRadius}
        {...PROPS_RANGES.brushRadius}
        format={fixed(1)}
        onChange={(v) => set({ brushRadius: v })}
      />
      <Slider
        label="Density"
        width={76}
        value={brush.density}
        {...PROPS_RANGES.density}
        format={fixed(2)}
        onChange={(v) => set({ density: v })}
      />
      <More label="Scatter" tip="More scatter settings">
        <PopRange
          label="Scale range"
          value={brush.scaleRange}
          {...SCATTER_SCALE_SPAN}
          format={(a, b) => `${a.toFixed(2)}–${b.toFixed(2)}`}
          onChange={(v) => set({ scaleRange: v })}
        />
        <PopRange
          label="Rotation"
          value={[Math.round(radToDeg(lo)), hi >= Math.PI * 2 - 1e-6 ? 360 : Math.round(radToDeg(hi))]}
          min={0}
          max={360}
          step={5}
          format={(a, b) => `${a}°–${b}°`}
          onChange={([a, b]) => set({ rotationRange: [degToRad(a), degToRad(b)] })}
        />
        <PopRow label="Spacing" value={brush.minSpacing.toFixed(1)}>
          <input
            type="range"
            className="v2-range v2-ppop__track"
            {...SCATTER_SPACING_SPAN}
            value={brush.minSpacing}
            aria-label="Spacing"
            style={{ '--v2-fill': `${((brush.minSpacing - SCATTER_SPACING_SPAN.min) / (SCATTER_SPACING_SPAN.max - SCATTER_SPACING_SPAN.min)) * 100}%` } as CSSProperties}
            onChange={(e) => set({ minSpacing: parseFloat(e.target.value) })}
          />
        </PopRow>
        <div className="v2-ppop__hr" role="separator" />
        <PopSwitch label="Avoid overlaps" checked={brush.avoidOverlap} onChange={(v) => set({ avoidOverlap: v })} />
        <PopSwitch label="Stay on floors" checked={brush.stayOnFloor} onChange={(v) => set({ stayOnFloor: v })} />
        <PopSwitch label="Random variant" checked={brush.randomVariant} onChange={(v) => set({ randomVariant: v })} />
        <div className="v2-ppop__hr" role="separator" />
        <Tints tints={brush.tints} />
        <div className="v2-ppop__hr" role="separator" />
        <PopSwitch
          label="Place under"
          aria="Place under existing props"
          checked={brush.placeUnder}
          onChange={(v) => set({ placeUnder: v })}
        />
        <div className="v2-ppop__row">
          <button
            type="button"
            className="v2-rbtn"
            onClick={() => set({ seed: 1 + Math.floor(Math.random() * 9999) })}
            data-testid="v2-props-reroll"
          >
            <Dices size={14} strokeWidth={1.75} />
            Re-roll
          </button>
          <span className="v2-rquiet v2-num v2-ppop__end">seed {brush.seed}</span>
        </div>
      </More>
    </>
  );
}

/** The Props tab's settings column: mode, then Stamp's or Scatter's controls. */
export function PropSettings() {
  const brush = useStore(useShallow((s) => s.tools.settings.scatterBrush));
  return (
    <>
      {/* Icons, named in their tips: the words would push the controls out of the row. */}
      <Seg
        label="Mode"
        value={brush.stampMode ? 'stamp' : 'scatter'}
        options={[
          { value: 'stamp', label: 'Stamp', icon: <Stamp size={13} strokeWidth={1.75} /> },
          { value: 'scatter', label: 'Scatter', icon: <SprayCan size={13} strokeWidth={1.75} /> },
        ]}
        onChange={(v) => set({ stampMode: v === 'stamp' })}
      />
      {brush.stampMode ? <StampSettings brush={brush} /> : <ScatterSettings brush={brush} />}
    </>
  );
}

/** After the settings: the view switch that lets the DM see and click under overhead props. */
export function PropsDockTail() {
  const on = useStore((s) => s.ui.seeUnderOverhead);
  return (
    <>
      <span className="v2-vr" role="presentation" />
      <div className="v2-dock__section">
        <Ctl label="See under overhead" wide>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="See under overhead"
            className={cn('v2-switch', on && 'v2-switch--on')}
            data-testid="v2-see-under-overhead"
            onClick={() => useStore.getState().setSeeUnderOverhead(!on)}
          >
            <span />
          </button>
        </Ctl>
      </div>
    </>
  );
}
