import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Link2,
  Unlink2,
} from 'lucide-react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDissolveGroupCommand, createRenameGroupCommand, SetGroupMergedCommand } from '@/store/commands';
import { groupSelection } from '@/canvas/groupActions';
import { namedGroupKey, isNamedGroupExpanded } from '@/store/selectors';
import type { AnyChild, AssetChild, ChildGroupInfo, Command, DungeonLayer } from '@/store/types';
import { familyMembers, familyPosition, getCatalogEntry } from '@dnd/core/src/assets/packCatalog';
import { GLOW_DEFAULT, propField, type PropFieldKey } from '@dnd/core/src/shared/propFields';
import {
  createAlignCommand,
  createDistributeCommand,
  createPropBoxCommand,
  createPropPatchCommand,
  createSetPropFieldsCommand,
  createSwapPropCommand,
  createZOrderCommand,
  type AlignEdge,
  type Box,
  type PropPatch,
  type ZOrderOp,
} from '@dnd/core/src/store/propEdits';
import { PackThumbnailCanvas } from '@/components/shared/PackThumbnailCanvas';
import { cn } from '@/lib/utils';
import { ColorCtl, RangeInput, Slider } from './controls';
import { EFFECTS, GLOW_STRENGTH_RANGE, SPEED_RANGE, animationFor } from './lightModel';
import { FloatMenu, type FloatMenuEntry } from './FloatMenu';
import {
  MIXED,
  MIXED_SWATCH,
  degToRad,
  isMixed,
  propBoxModel,
  propFieldCount,
  propFieldsModel,
  radToDeg,
  type Mixed,
  type PropTarget,
} from './selectionModel';
import { CardActions, LockedNote } from './CardActions';
import './rooms.css';
import './selection-card.css';
import './props.css';
import './lighting.css';

/*
 * The selection card for props (boards Prop, Multi, Group). Every edit is one command
 * through the undo manager; a drag on a slider or a visit to the colour picker previews
 * live and lands as one step when it ends. A locked prop shows its fields read-only and
 * keeps only its Lock switch.
 */

type Patch = Record<string, unknown>;
interface Ref {
  layerId: string;
  id: string;
}

function run(cmd: Command | null): void {
  if (cmd) undoManager.execute(cmd);
}

/**
 * A gesture on the card (an opacity drag, a tint visit) patches the store on every tick,
 * off the undo stack, and lands as one prop patch when it ends: attached lights follow it,
 * and undo gives every prop back what it had.
 */
function usePropLive() {
  const prior = useRef<Map<string, { layerId: string; before: Patch }> | null>(null);

  const live = useCallback((refs: readonly Ref[], patch: Patch) => {
    const snap = prior.current ?? new Map<string, { layerId: string; before: Patch }>();
    const state = useStore.getState();
    for (const r of refs) {
      const layer = state.layers.find((l) => l.id === r.layerId) as DungeonLayer | undefined;
      const c = layer?.children.find((x) => x.id === r.id) as unknown as Patch | undefined;
      if (!c) continue;
      const entry = snap.get(r.id) ?? { layerId: r.layerId, before: {} };
      for (const k of Object.keys(patch)) if (!(k in entry.before)) entry.before[k] = structuredClone(c[k]);
      snap.set(r.id, entry);
    }
    prior.current = snap;
    useStore.setState((s) => {
      for (const r of refs) {
        const l = s.layers.find((x) => x.id === r.layerId);
        if (!l || l.type !== 'dungeon') continue;
        const c = (l as DungeonLayer).children.find((x) => x.id === r.id);
        if (c) Object.assign(c, patch);
      }
    });
  }, []);

  const commit = useCallback((label: string) => {
    const snap = prior.current;
    prior.current = null;
    if (!snap) return;
    const state = useStore.getState();
    const patches: PropPatch[] = [];
    for (const [id, { layerId, before }] of snap) {
      const layer = state.layers.find((l) => l.id === layerId) as DungeonLayer | undefined;
      const c = layer?.children.find((x) => x.id === id) as unknown as Patch | undefined;
      if (!c) continue;
      const after: Patch = {};
      for (const k of Object.keys(before)) after[k] = c[k];
      if (Object.keys(before).every((k) => Object.is(before[k], after[k]))) continue;
      patches.push({ layerId, id, before: before as Partial<AnyChild>, after: after as Partial<AnyChild> });
    }
    if (patches.length === 0) return;
    // The store already shows the end state; the command records it (and moves attached lights).
    useStore.setState((s) => {
      for (const p of patches) {
        const l = s.layers.find((x) => x.id === p.layerId);
        const c = l && l.type === 'dungeon' ? (l as DungeonLayer).children.find((x) => x.id === p.id) : undefined;
        if (c) Object.assign(c, p.before);
      }
    });
    run(createPropPatchCommand(label, patches));
  }, []);

  return { live, commit };
}

/* ── Pieces ─────────────────────────────────────────────── */

const FOLDS_KEY = 'v2-prop-folds';

function loadFolds(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(FOLDS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** A foldable section, open unless the DM folded it this session. */
export function Section({
  title,
  quiet,
  tight,
  children,
  testId,
}: {
  title: string;
  quiet?: string;
  tight?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(() => loadFolds()[title] !== false);
  const toggle = () => {
    setOpen((o) => {
      try {
        sessionStorage.setItem(FOLDS_KEY, JSON.stringify({ ...loadFolds(), [title]: !o }));
      } catch {
        /* private mode: the folds just forget */
      }
      return !o;
    });
  };
  return (
    <div className={cn('v2-rsec', tight && 'v2-psec--tight')} data-testid={testId}>
      <div className="v2-rsec__head">
        <button type="button" className="v2-selc__disclose" aria-expanded={open} onClick={toggle}>
          <ChevronRight size={12} strokeWidth={2} aria-hidden />
          <span>{title}</span>
        </button>
        {quiet && <span className="v2-rquiet">{quiet}</span>}
      </div>
      {open && children}
    </div>
  );
}

/**
 * A number in a box, typed: commits on Enter or leaving the field, Escape puts it back.
 * `label` is the letter before the number (X, W); `unit` the word after it (ft, °, ×).
 */
export function NumBox({
  label,
  title,
  value,
  format,
  disabled,
  onCommit,
  className,
  unit,
}: {
  label: string;
  title: string;
  value: Mixed<number>;
  format: (v: number) => string;
  disabled?: boolean;
  onCommit: (v: number) => void;
  className?: string;
  unit?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const mixed = isMixed(value);
  const shown = text ?? (mixed ? '' : format(value));
  return (
    <label className={cn('v2-field v2-pnum', disabled && 'v2-pnum--off', className)}>
      {label && <span>{label}</span>}
      <input
        className="v2-num"
        inputMode="decimal"
        value={shown}
        placeholder={mixed ? 'Mixed' : undefined}
        aria-label={title}
        disabled={disabled}
        spellCheck={false}
        onFocus={() => {
          cancelled.current = false;
          setText(shown);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const raw = text;
          setText(null);
          if (cancelled.current || raw === null) return;
          const v = parseFloat(raw);
          if (Number.isFinite(v) && (mixed || format(v) !== format(value))) onCommit(v);
        }}
        onKeyDown={(e) => {
          // Keys typed here are not canvas shortcuts.
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      {unit !== undefined && <span className="v2-pnum__unit">{unit}</span>}
    </label>
  );
}

/** A switch with three states: on, off, and mixed over several props (a click turns it on). */
export function CardSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean | typeof MIXED;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const mixed = checked === MIXED;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      className={cn('v2-switch', checked === true && 'v2-switch--on', mixed && 'v2-switch--mixed')}
      onClick={() => onChange(mixed ? true : !checked)}
    >
      <span />
    </button>
  );
}

const ORDER: { op: ZOrderOp; label: string; icon: ReactNode }[] = [
  { op: 'back', label: 'Send to back (Ctrl+Shift+[)', icon: <ArrowDownToLine size={14} strokeWidth={1.75} /> },
  { op: 'backward', label: 'Send backward (Ctrl+[)', icon: <ArrowDown size={14} strokeWidth={1.75} /> },
  { op: 'forward', label: 'Bring forward (Ctrl+])', icon: <ArrowUp size={14} strokeWidth={1.75} /> },
  { op: 'front', label: 'Bring to front (Ctrl+Shift+])', icon: <ArrowUpToLine size={14} strokeWidth={1.75} /> },
];

function OrderRow({ ids, disabled }: { ids: string[]; disabled?: boolean }) {
  return (
    <div className="v2-rrow">
      <span className="v2-rrow__lbl">Order</span>
      <span className="v2-prow__btns" role="group" aria-label="Order">
        {ORDER.map((o) => (
          <button
            key={o.op}
            type="button"
            className="v2-ib v2-ib--sm"
            aria-label={o.label}
            data-tip={o.label}
            disabled={disabled}
            onClick={() => run(createZOrderCommand(ids, o.op))}
          >
            {o.icon}
          </button>
        ))}
      </span>
    </div>
  );
}

const fmt2 = (v: number) => v.toFixed(2);
const fmtDeg = (v: number) => `${Math.round(v)}°`;

/**
 * X, Y (centre), W, H and the angle of one prop's own box or of several props' one box.
 * W and H keep their ratio while the link is on. One command per typed value.
 */
function TransformFields({
  children,
  disabled,
  flips,
}: {
  children: readonly AssetChild[];
  disabled?: boolean;
  /** One prop: Flip H and Flip V beside the angle. */
  flips?: { onFlip: (axis: 'x' | 'y') => void };
}) {
  const [linked, setLinked] = useState(true);
  const box = propBoxModel(children);
  const ids = children.map((c) => c.id);
  const from: Box & { angle: number } = { x: box.x, y: box.y, w: box.w, h: box.h, angle: isMixed(box.angle) ? 0 : box.angle };
  const commit = (to: Partial<Box & { angle: number }>) => run(createPropBoxCommand(ids, from, { ...from, ...to }));
  const ratio = box.w > 0 ? box.h / box.w : 1;
  const angleDeg: Mixed<number> = isMixed(box.angle) ? MIXED : radToDeg(box.angle);
  return (
    <>
      <div className="v2-pgrid">
        <NumBox label="X" title="X (centre, squares)" value={box.x} format={fmt2} disabled={disabled} onCommit={(x) => commit({ x })} />
        <NumBox label="Y" title="Y (centre, squares)" value={box.y} format={fmt2} disabled={disabled} onCommit={(y) => commit({ y })} />
      </div>
      <div className="v2-pgrid">
        <NumBox
          label="W"
          title="Width (squares)"
          value={box.w}
          format={fmt2}
          disabled={disabled}
          onCommit={(w) => w > 0 && commit(linked ? { w, h: w * ratio } : { w })}
        />
        <NumBox
          label="H"
          title="Height (squares)"
          value={box.h}
          format={fmt2}
          disabled={disabled}
          onCommit={(h) => h > 0 && commit(linked ? { h, w: ratio > 0 ? h / ratio : h } : { h })}
        />
        <button
          type="button"
          className={cn('v2-ib v2-ib--sm', linked && 'v2-ib--on')}
          aria-label="Keep W:H ratio"
          aria-pressed={linked}
          data-tip={linked ? 'W and H keep their ratio' : 'W and H change on their own'}
          disabled={disabled}
          onClick={() => setLinked((l) => !l)}
        >
          {linked ? <Link2 size={14} strokeWidth={1.75} /> : <Unlink2 size={14} strokeWidth={1.75} />}
        </button>
      </div>
      <div className="v2-pgrid">
        <NumBox
          label="Angle"
          title="Angle (degrees)"
          value={angleDeg}
          format={fmtDeg}
          disabled={disabled}
          onCommit={(deg) => commit({ angle: degToRad(deg) })}
        />
        {flips && (
          <span className="v2-prow__btns">
            <button
              type="button"
              className="v2-ib v2-ib--sm"
              aria-label="Flip horizontal (Shift+H)"
              data-tip="Flip horizontal"
              data-tip-key="Shift H"
              disabled={disabled}
              onClick={() => flips.onFlip('x')}
            >
              <FlipHorizontal2 size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="v2-ib v2-ib--sm"
              aria-label="Flip vertical (Shift+V)"
              data-tip="Flip vertical"
              data-tip-key="Shift V"
              disabled={disabled}
              onClick={() => flips.onFlip('y')}
            >
              <FlipVertical2 size={14} strokeWidth={1.75} />
            </button>
          </span>
        )}
      </div>
    </>
  );
}

/** Tint and opacity, live while dragging or picking, one step each visit. */
function LookFields({ refs, children, disabled }: { refs: Ref[]; children: readonly AssetChild[]; disabled?: boolean }) {
  const { live, commit } = usePropLive();
  const m = propFieldsModel(children);
  const tintMixed = isMixed(m.tint);
  const tint = tintMixed ? MIXED_SWATCH : (m.tint as string);
  const none = !tintMixed && tint.toLowerCase() === '#ffffff';
  const opacity = isMixed(m.opacity) ? 1 : (m.opacity as number);
  const ids = refs.map((r) => r.id);
  return (
    <>
      <div className={cn('v2-rrow v2-selc', (none || tintMixed) && 'v2-selc--none', disabled && 'v2-prow--off')}>
        <ColorCtl
          label="Tint"
          placement="beside"
          value={tint}
          tip={tintMixed ? 'Tints differ' : none ? 'No tint' : tint.toUpperCase()}
          onChange={(c) => !disabled && live(refs, { tint: c })}
          onCommit={() => commit('Prop tint')}
        />
        <span className="v2-selc__value v2-num">{tintMixed ? 'Mixed' : none ? 'None' : tint.toUpperCase()}</span>
        {!none && !tintMixed && !disabled && (
          <button type="button" className="v2-link v2-rend" onClick={() => run(createSetPropFieldsCommand(ids, { tint: '#ffffff' }))}>
            None
          </button>
        )}
      </div>
      <div className={cn('v2-rrow v2-selc', disabled && 'v2-prow--off')}>
        <Slider
          label="Opacity"
          value={opacity}
          min={0}
          max={1}
          step={0.01}
          format={(v) => (isMixed(m.opacity) ? 'Mixed' : `${Math.round(v * 100)}%`)}
          onChange={(v) => !disabled && live(refs, { opacity: v })}
          onCommit={() => commit('Prop opacity')}
        />
      </div>
    </>
  );
}

const setFields = (ids: string[], patch: Partial<Pick<AssetChild, PropFieldKey | 'tint'>>) =>
  run(createSetPropFieldsCommand(ids, patch));

/** "Mixed: 1 of 3", "All 4" or nothing, beside a switch over several props. */
function countNote(on: number, total: number, noneText = ''): string {
  if (on === 0) return noneText;
  if (on === total) return `All ${total}`;
  return `Mixed: ${on} of ${total}`;
}

const BEHAVIOUR: { key: PropFieldKey; label: string; tableOnly?: boolean }[] = [
  { key: 'castsShadow', label: 'Casts shadow' },
  { key: 'blocksLight', label: 'Blocks light and sight' },
  { key: 'blocksMovement', label: 'Blocks movement', tableOnly: true },
  { key: 'glows', label: 'Glows' },
];

/**
 * Casts shadow, Blocks light and sight and Glows, live; Blocks movement stays greyed until the
 * table reads it. With Glows on, its strength and animation hang under it.
 */
function BehaviourRows({ child, layerId, disabled }: { child: AssetChild; layerId: string; disabled?: boolean }) {
  const { live, commit } = usePropLive();
  const ids = [child.id];
  const refs = [{ layerId, id: child.id }];
  const glows = propField(child, 'glows') as boolean;
  const glow = child.glow ?? GLOW_DEFAULT;
  const effect = glow.animation?.kind ?? 'none';
  const speed = glow.animation?.speed ?? 1;
  const strength = (v: number) => Math.min(GLOW_STRENGTH_RANGE.max, Math.max(GLOW_STRENGTH_RANGE.min, Math.round(v * 100) / 100));
  const pace = (v: number) => Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, Math.round(v * 20) / 20));
  const setGlow = (next: AssetChild['glow']) => run(createSetPropFieldsCommand(ids, { glow: next }));
  return (
    <>
      {BEHAVIOUR.map((b) => (
        <div key={b.key} className={cn('v2-rrow v2-prow--tight', b.tableOnly && 'v2-prow--greyed')}>
          <span className="v2-rrow__lbl v2-prow__wide">{b.label}</span>
          <CardSwitch
            label={b.label}
            checked={propField(child, b.key) as boolean}
            disabled={disabled || b.tableOnly}
            onChange={(v) => setFields(ids, { [b.key]: v })}
          />
          {b.tableOnly && <span className="v2-rtag v2-rend">Table pass</span>}
        </div>
      ))}
      {glows && (
        <>
          <div className={cn('v2-rrow v2-prow--sub', disabled && 'v2-prow--off')}>
            <span className="v2-rrow__lbl">Strength</span>
            <span className="v2-pscale">
              <RangeInput
                label="Glow strength"
                value={glow.strength}
                {...GLOW_STRENGTH_RANGE}
                onChange={(v) => live(refs, { glow: { ...glow, strength: strength(v) } })}
                onCommit={() => commit('Glow strength')}
              />
              <NumBox
                label=""
                title="Glow strength"
                value={glow.strength}
                format={(v) => v.toFixed(2)}
                unit=""
                onCommit={(v) => setGlow({ ...glow, strength: strength(v) })}
              />
            </span>
          </div>
          <div className={cn('v2-rrow v2-prow--sub', disabled && 'v2-prow--off')}>
            <span className="v2-rrow__lbl">Animation</span>
            <span className="v2-seg" role="group" aria-label="Glow animation">
              {EFFECTS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={effect === o.value}
                  onClick={() => effect !== o.value && setGlow({ ...glow, animation: animationFor(o.value, speed) })}
                >
                  {o.label}
                </button>
              ))}
            </span>
          </div>
          <div className={cn('v2-rrow v2-prow--sub', (disabled || effect === 'none') && 'v2-prow--off')}>
            <span className="v2-rrow__lbl">Speed</span>
            <span className="v2-pscale">
              <RangeInput
                label="Glow speed"
                value={speed}
                {...SPEED_RANGE}
                onChange={(v) => live(refs, { glow: { ...glow, animation: animationFor(effect, pace(v)) } })}
                onCommit={() => commit('Glow speed')}
              />
              <NumBox
                label=""
                title="Glow speed"
                value={speed}
                format={(v) => v.toFixed(1)}
                unit="×"
                disabled={effect === 'none'}
                onCommit={(v) => setGlow({ ...glow, animation: animationFor(effect, pace(v)) })}
              />
            </span>
          </div>
        </>
      )}
    </>
  );
}

/* ── One prop ───────────────────────────────────────────── */

function familyName(assetId: string): string | null {
  const entry = getCatalogEntry(assetId) as (ReturnType<typeof getCatalogEntry> & { family?: string }) | undefined;
  const name = entry?.family?.replace(/_/g, ' ');
  return name ? name[0].toUpperCase() + name.slice(1) : null;
}

function PropCard({ child, layer }: { child: AssetChild; layer: DungeonLayer }) {
  // Families and labels arrive with the packs, after boot.
  useStore((s) => s.packs.installedPacks);
  const locked = propField(child, 'locked');
  const refs = [{ layerId: layer.id, id: child.id }];
  const ids = [child.id];
  const isAsset = child.objectType === 'asset';
  const { index, count } = isAsset ? familyPosition(child.assetId) : { index: 0, count: 0 };
  const family = count > 1 ? familyName(child.assetId) : null;
  const members = isAsset && count > 1 ? familyMembers(child.assetId) : [];
  const flip = (axis: 'x' | 'y') => {
    const key = axis === 'x' ? 'flipX' : 'flipY';
    run(
      createPropPatchCommand(axis === 'x' ? 'Flip horizontal' : 'Flip vertical', [
        { layerId: layer.id, id: child.id, before: { [key]: child[key] }, after: { [key]: !child[key] } },
      ]),
    );
  };
  return (
    <>
      <header className="v2-sel__head v2-pcard__head">
        <span className="v2-sel__name">{child.name || getCatalogEntry(child.assetId)?.label || 'Prop'}</span>
        {family && (
          <span className="v2-rtag" data-testid="v2-prop-family-chip">
            {family} · {index}/{count}
          </span>
        )}
        <span className="v2-sel__kind v2-rend">{locked ? 'Prop · locked' : 'Prop'}</span>
      </header>
      <CardActions />
      {locked && <LockedNote />}

      <Section title="Transform" testId="v2-prop-transform">
        <TransformFields children={[child]} disabled={locked} flips={{ onFlip: flip }} />
      </Section>

      <Section title="Look" testId="v2-prop-look">
        <LookFields refs={refs} children={[child]} disabled={locked} />
      </Section>

      <Section title="Layering" testId="v2-prop-layering">
        <OrderRow ids={ids} disabled={locked} />
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Overhead</span>
          <CardSwitch label="Overhead" checked={propField(child, 'overhead')} disabled={locked} onChange={(v) => setFields(ids, { overhead: v })} />
          <span className="v2-rrow__lbl v2-prow__lock">Lock</span>
          <CardSwitch label="Lock" checked={locked} onChange={(v) => setFields(ids, { locked: v })} />
        </div>
      </Section>

      {isAsset && (
        <Section title="Variant" quiet={count > 1 ? `${index}/${count}` : undefined} testId="v2-prop-variant">
          <div className="v2-rrow v2-pvariants">
            {members.map((m) => {
              const on = m.id === child.assetId;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={cn('v2-swatch', on && 'v2-swatch--on')}
                  aria-pressed={on}
                  aria-label={m.label}
                  data-tip={m.label}
                  disabled={locked}
                  onClick={() => !on && run(createSwapPropCommand(ids, m.id, 'footprint'))}
                >
                  <PackThumbnailCanvas textureId={m.id} />
                </button>
              );
            })}
            {members.length === 0 && <span className="v2-rquiet">No other variants</span>}
            <button
              type="button"
              className="v2-link v2-rend"
              disabled={locked}
              data-testid="v2-prop-replace"
              onClick={() => useStore.getState().setPropReplaceIds(ids)}
            >
              Replace…
            </button>
          </div>
        </Section>
      )}

      <Section title="Behaviour" tight testId="v2-prop-behaviour">
        <BehaviourRows child={child} layerId={layer.id} disabled={locked} />
      </Section>
    </>
  );
}

/* ── Several props ──────────────────────────────────────── */

const ALIGN: { edge: AlignEdge; label: string; icon: ReactNode }[] = [
  { edge: 'left', label: 'Align left', icon: <AlignStartVertical size={14} strokeWidth={1.75} /> },
  { edge: 'hcenter', label: 'Align centre', icon: <AlignCenterVertical size={14} strokeWidth={1.75} /> },
  { edge: 'right', label: 'Align right', icon: <AlignEndVertical size={14} strokeWidth={1.75} /> },
  { edge: 'top', label: 'Align top', icon: <AlignStartHorizontal size={14} strokeWidth={1.75} /> },
  { edge: 'vcenter', label: 'Align middle', icon: <AlignCenterHorizontal size={14} strokeWidth={1.75} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal size={14} strokeWidth={1.75} /> },
];

function ArrangeRow({ ids }: { ids: string[] }) {
  const alignRef = useRef<HTMLButtonElement>(null);
  const distRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<'align' | 'distribute' | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const alignEntries: FloatMenuEntry[] = ALIGN.flatMap((a, i): FloatMenuEntry[] => {
    const entry: FloatMenuEntry = {
      label: a.label,
      icon: a.icon,
      onSelect: () => run(createAlignCommand(ids, a.edge)),
      testId: `v2-align-${a.edge}`,
    };
    return i === 3 ? ['divider', entry] : [entry];
  });
  const few = ids.length < 3;
  const distEntries: FloatMenuEntry[] = [
    { label: 'Horizontally', onSelect: () => run(createDistributeCommand(ids, 'h')), disabled: few, testId: 'v2-distribute-h' },
    { label: 'Vertically', onSelect: () => run(createDistributeCommand(ids, 'v')), disabled: few, testId: 'v2-distribute-v' },
  ];
  return (
    <div className="v2-rrow">
      <button
        ref={alignRef}
        type="button"
        className={cn('v2-rbtn', menu === 'align' && 'v2-rbtn--open')}
        aria-haspopup="menu"
        aria-expanded={menu === 'align'}
        onClick={() => setMenu(menu === 'align' ? null : 'align')}
      >
        <AlignStartVertical size={14} strokeWidth={1.75} />
        Align
        <ChevronDown size={12} strokeWidth={1.75} />
      </button>
      <button
        ref={distRef}
        type="button"
        className={cn('v2-rbtn', menu === 'distribute' && 'v2-rbtn--open')}
        aria-haspopup="menu"
        aria-expanded={menu === 'distribute'}
        data-tip={few ? 'Select three or more to distribute' : undefined}
        onClick={() => setMenu(menu === 'distribute' ? null : 'distribute')}
      >
        <AlignHorizontalDistributeCenter size={14} strokeWidth={1.75} />
        Distribute
        <ChevronRight size={12} strokeWidth={1.75} />
      </button>
      <FloatMenu open={menu === 'align'} onClose={close} label="Align" entries={alignEntries} anchor={alignRef} width={216} />
      <FloatMenu open={menu === 'distribute'} onClose={close} label="Distribute" entries={distEntries} anchor={distRef} width={180} />
    </div>
  );
}

function PropsCard({ children, layerIds }: { children: AssetChild[]; layerIds: string[] }) {
  const refs = children.map((c, i) => ({ layerId: layerIds[i], id: c.id }));
  const ids = children.map((c) => c.id);
  // Locked props are left out of edits; with all of them locked only Lock acts.
  const editable = children.filter((c) => !propField(c, 'locked'));
  const editIds = editable.map((c) => c.id);
  const allLocked = editable.length === 0;
  const n = children.length;
  const overhead = propFieldCount(children, 'overhead');
  const locked = propFieldCount(children, 'locked');
  return (
    <>
      <header className="v2-sel__head">
        <span className="v2-sel__name">{n} props</span>
        <span className="v2-sel__kind">Props</span>
      </header>
      <CardActions />

      <Section title="Transform" quiet="One box" testId="v2-props-transform">
        <TransformFields children={allLocked ? children : editable} disabled={allLocked} />
      </Section>

      <Section title="Arrange" testId="v2-props-arrange">
        <ArrangeRow ids={editIds} />
        <OrderRow ids={editIds} disabled={allLocked} />
      </Section>

      <Section title="Look" testId="v2-props-look">
        <LookFields refs={refs.filter((r) => editIds.includes(r.id))} children={allLocked ? children : editable} disabled={allLocked} />
      </Section>

      <Section title="Layering" testId="v2-props-layering">
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Overhead</span>
          <CardSwitch
            label="Overhead"
            checked={overhead === 0 ? false : overhead === n ? true : MIXED}
            disabled={allLocked}
            onChange={(v) => setFields(editIds, { overhead: v })}
          />
          <span className="v2-rquiet">{countNote(overhead, n)}</span>
        </div>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Lock</span>
          <CardSwitch
            label="Lock all"
            checked={locked === 0 ? false : locked === n ? true : MIXED}
            onChange={(v) => setFields(ids, { locked: v })}
          />
          <span className="v2-rquiet">{locked === 0 ? 'None locked' : locked === n ? 'All locked' : `${locked} of ${n} locked`}</span>
        </div>
      </Section>

      <div className="v2-pcard__foot">
        <button type="button" className="v2-rbtn" onClick={() => groupSelection(true)}>
          <Group size={14} strokeWidth={1.75} />
          Group
        </button>
        <span className="v2-rquiet v2-rend">Ctrl+G</span>
      </div>
    </>
  );
}

/* ── A group ────────────────────────────────────────────── */

function GroupName({ layer, group }: { layer: DungeonLayer; group: ChildGroupInfo }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <label className="v2-field v2-rfield">
      <input
        value={draft ?? group.name}
        aria-label="Group name"
        spellCheck={false}
        onFocus={() => {
          cancelled.current = false;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft?.trim();
          setDraft(null);
          if (cancelled.current || !next || next === group.name) return;
          run(createRenameGroupCommand(useStore.getState().layers, layer.id, group.id, next));
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function GroupCard({
  group,
  layer,
  members,
  onOpenLayers,
}: {
  group: ChildGroupInfo;
  layer: DungeonLayer;
  members: AnyChild[];
  onOpenLayers?: () => void;
}) {
  const props = members.filter((c): c is AssetChild => c.childType === 'asset');
  const editable = props.filter((c) => !propField(c, 'locked'));
  const allIds = members.map((c) => c.id);
  const propIds = props.map((c) => c.id);
  const n = props.length;
  const overhead = propFieldCount(props, 'overhead');
  const locked = propFieldCount(props, 'locked');
  const merged = !!group.merged;
  const kinds = members.length === n ? `${n} prop${n === 1 ? '' : 's'}` : `${members.length} objects, ${n} prop${n === 1 ? '' : 's'}`;
  const showMembers = () => {
    const s = useStore.getState();
    if (!isNamedGroupExpanded(s, layer.id, group.id)) s.toggleChildGroup(namedGroupKey(layer.id, group.id));
    s.setRevealChildId(members[0]?.id ?? null);
    onOpenLayers?.();
  };
  return (
    <>
      <header className="v2-sel__head">
        <span className="v2-sel__name">{group.name}</span>
        <span className="v2-sel__kind">Group</span>
      </header>
      <CardActions />
      <div className="v2-rcard__own">
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Name</span>
          <GroupName layer={layer} group={group} />
        </div>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Members</span>
          <span className="v2-num v2-rsmall">{kinds}</span>
          {onOpenLayers && (
            <button type="button" className="v2-link v2-rend" onClick={showMembers}>
              Select members
            </button>
          )}
        </div>
      </div>

      <Section title="Box" testId="v2-group-box">
        <TransformFields children={editable.length > 0 ? editable : props} disabled={editable.length === 0} />
      </Section>

      <Section title="Group" testId="v2-group-fields">
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Merged</span>
          <CardSwitch label="Merged" checked={merged} onChange={(v) => run(new SetGroupMergedCommand(layer.id, group.id, v))} />
          <span className="v2-rquiet">{merged ? 'Clicks take the whole group' : 'Members click one by one'}</span>
        </div>
        <OrderRow ids={allIds} />
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Overhead</span>
          <CardSwitch
            label="Overhead, all members"
            checked={overhead === 0 ? false : overhead === n ? true : MIXED}
            onChange={(v) => setFields(editable.map((c) => c.id), { overhead: v })}
          />
          <span className="v2-rquiet">{countNote(overhead, n, `All ${n}`)}</span>
        </div>
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Lock</span>
          <CardSwitch
            label="Lock all members"
            checked={locked === 0 ? false : locked === n ? true : MIXED}
            onChange={(v) => setFields(propIds, { locked: v })}
          />
          <span className="v2-rquiet">{countNote(locked, n, `All ${n}`)}</span>
        </div>
      </Section>

      <div className="v2-pcard__foot">
        <button
          type="button"
          className="v2-rbtn"
          onClick={() => run(createDissolveGroupCommand(useStore.getState().layers, layer.id, group.id))}
        >
          Ungroup
        </button>
        <span className="v2-rquiet v2-rend">Members stay where they are</span>
      </div>
    </>
  );
}

/** The whole card for one prop, several props, or a group. */
export function PropTargetCard({ target, onOpenLayers }: { target: PropTarget; onOpenLayers?: () => void }) {
  return (
    <section className="v2-sel v2-float v2-pcard" data-testid="v2-selection-card" data-prop-kind={target.kind} data-keys="canvas" data-chrome aria-label="Selection">
      {target.kind === 'prop' ? (
        <PropCard key={target.child.id} child={target.child} layer={target.layer} />
      ) : target.kind === 'props' ? (
        <PropsCard children={target.children} layerIds={target.layerIds} />
      ) : (
        <GroupCard group={target.group} layer={target.layer} members={target.members} onOpenLayers={onOpenLayers} />
      )}
    </section>
  );
}
