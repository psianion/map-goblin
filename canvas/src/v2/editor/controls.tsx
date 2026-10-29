import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import { cn } from '@/lib/utils';
import { placePopover, type PopPlacement } from './popPlacement';

/* Shared v2 controls. Class names and markup are what `v2-editor.css` styles; keep them. */

/** An anchored popover floats free of the card or dock it belongs to; CSS offsets are reset. */
const ANCHORED_STYLE: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 'auto', bottom: 'auto', margin: 0 };

/**
 * A card that opens above its trigger inside the dock. Closes on Escape and on a press
 * outside it, but not on the colour and texture pickers the v1 fields open in portals.
 *
 * With `anchor`, it is portalled to the page and placed against the anchor's box instead,
 * so a scrolling card or the dock cannot clip it and nothing drawn later covers it.
 */
export function DockPopover({
  open,
  onClose,
  className,
  label,
  children,
  anchor,
  placement = 'above',
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  label: string;
  children: ReactNode;
  anchor?: RefObject<HTMLElement | null>;
  placement?: PopPlacement;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const el = ref.current;
      const a = anchor.current;
      if (!el || !a) return;
      const box = a.getBoundingClientRect();
      const frame = placement === 'beside' ? (a.closest('.v2-float')?.getBoundingClientRect() ?? box) : box;
      const at = placePopover(
        placement,
        box,
        frame,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
    };
    place();
    // Follow the trigger when its card scrolls or the window changes size.
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      // The trigger toggles itself.
      if (anchor ? anchor.current?.contains(t) : ref.current?.parentElement?.contains(t)) return;
      // Nor on an anchored popover opened from inside this one: it lives in a portal.
      if (t.closest?.('[data-color-picker], [data-texture-picker], [data-anchored-pop]')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  const pop = (
    <div
      ref={ref}
      className={cn('v2-pop v2-float', className)}
      role="dialog"
      aria-label={label}
      style={anchor ? ANCHORED_STYLE : undefined}
      data-chrome={anchor ? true : undefined}
      data-anchored-pop={anchor ? true : undefined}
    >
      {children}
    </div>
  );
  return anchor ? createPortal(pop, document.body) : pop;
}

/** `width` sizes the column for its longest label and value, so nothing reflows as values change. */
export function Ctl({
  label,
  value,
  wide,
  width,
  children,
}: {
  label: string;
  value?: string;
  wide?: boolean;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div className={cn('v2-ctl', wide && 'v2-ctl--wide')} style={width ? { width } : undefined}>
      <span className="v2-ctl__head">
        <span>{label}</span>
        {value !== undefined && <span className="v2-num">{value}</span>}
      </span>
      <span className="v2-ctl__body">{children}</span>
    </div>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Called once a drag or key run ends, with the value it started from. */
  onCommit?: (v: number, start: number) => void;
  width?: number;
}

/** The bare track, for a control that shares its column with something else. */
export function RangeInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  className,
}: Omit<SliderProps, 'format' | 'width'> & { className?: string }) {
  const start = useRef<number | null>(null);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const end = (v: number) => {
    if (start.current === null) return;
    const from = start.current;
    start.current = null;
    onCommit?.(v, from);
  };
  return (
    <input
      type="range"
      className={cn('v2-range', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      style={{ '--v2-fill': `${pct}%` } as CSSProperties}
      onPointerDown={() => {
        if (start.current === null) start.current = value;
      }}
      onKeyDown={() => {
        if (start.current === null) start.current = value;
      }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={(e) => end(parseFloat(e.currentTarget.value))}
      onKeyUp={(e) => end(parseFloat(e.currentTarget.value))}
      onBlur={(e) => end(parseFloat(e.currentTarget.value))}
    />
  );
}

export function Slider({ format, width, ...range }: SliderProps) {
  return (
    <Ctl label={range.label} value={format(range.value)} width={width}>
      <RangeInput {...range} />
    </Ctl>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Ctl label={label} width={44}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn('v2-switch', checked && 'v2-switch--on')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </Ctl>
  );
}

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  /**
   * With an icon, the button shows the icon and names itself in its tip. `tip` says
   * more than the label does (what the choice means); it replaces the icon's name tip.
   */
  options: { value: T; label: string; icon?: ReactNode; tip?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Ctl label={label} wide>
      <span className="v2-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.icon ? 'v2-seg__icon' : undefined}
            aria-pressed={value === o.value}
            aria-label={o.icon ? o.label : undefined}
            data-tip={o.tip ?? (o.icon ? o.label : undefined)}
            onClick={() => onChange(o.value)}
          >
            {o.icon ?? o.label}
          </button>
        ))}
      </span>
    </Ctl>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  width,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  width?: number;
}) {
  return (
    <Ctl label={label} width={width}>
      <select className="v2-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Ctl>
  );
}

function normalizeHex(raw: string): string | null {
  const t = raw.trim();
  const v = t.startsWith('#') ? t : `#${t}`;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return null;
}

/**
 * A colour as a swatch. The swatch is content (it shows the colour the stroke will take);
 * the card it opens is chrome, neutral like the rest of the dock. One undo step per visit.
 * `children` sit beside the swatch in the same column (a tint's strength, say), with
 * `readout` as the column's value.
 */
export function ColorCtl({
  label,
  value,
  onChange,
  onCommit,
  readout,
  placement = 'above',
  tip,
  children,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
  onCommit?: (c: string, start: string) => void;
  readout?: string;
  /** 'beside' for a swatch in a card: the picker opens left of the card, level with the swatch. */
  placement?: PopPlacement;
  /** Tooltip for the swatch; the hex value when absent. */
  tip?: string;
  children?: ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const start = useRef(value);
  const close = useCallback(() => {
    setOpen(false);
    onCommit?.(value, start.current);
  }, [value, onCommit]);
  const submit = () => {
    const next = normalizeHex(hex);
    if (next) onChange(next);
    setHex(next ?? value);
  };
  return (
    <div className="v2-ctl-anchor" ref={anchor}>
      <Ctl label={label} value={readout} wide>
        <button
          type="button"
          className={cn('v2-color', open && 'v2-color--open')}
          style={{ background: value }}
          aria-label={`${label} colour, ${value}`}
          aria-expanded={open}
          data-tip={tip ?? value.toUpperCase()}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            start.current = value;
            setHex(value);
            setOpen(true);
          }}
        />
        {children}
      </Ctl>
      <DockPopover
        open={open}
        onClose={close}
        className="v2-pop--color"
        label={`${label} colour`}
        anchor={anchor}
        placement={placement}
      >
        <HexColorPicker
          color={value}
          onChange={(c) => {
            setHex(c);
            onChange(c);
          }}
        />
        <input
          className="v2-hex v2-num"
          value={hex}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex colour"
          onChange={(e) => setHex(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </DockPopover>
    </div>
  );
}

/** A low and a high on one track, for ranges like a stamp's scale. */
export function RangePair({
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
  format: (v: number) => string;
  onChange: (v: [number, number]) => void;
}) {
  const [lo, hi] = value;
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <Ctl label={label} value={`${format(lo)} to ${format(hi)}`} wide>
      <span className="v2-pair" style={{ '--v2-lo': pct(lo), '--v2-hi': pct(hi) } as CSSProperties}>
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
    </Ctl>
  );
}
