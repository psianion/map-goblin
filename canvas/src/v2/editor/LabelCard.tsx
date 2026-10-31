import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { CompositeCommand, PropertyCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, Command, DungeonLayer, LabelStyleId, TextChild } from '@/store/types';
import { measureLabel } from '@dnd/core/src/engine/labelMetrics';
import { getChildBounds } from '@dnd/core/src/engine/hitTest';
import { LABEL_SIZE_RANGE, removeFreshLabel, takeLabelFocus } from '@dnd/core/src/engine/tools/TextTool';
import {
  LABEL_STYLES,
  bindingFields,
  findBindTarget,
  labelStyle,
  styleLook,
} from '@dnd/core/src/shared/labelStyles';
import { ColorCtl, RangeInput } from './controls';
import { CardSwitch, NumBox, Section } from './PropCards';
import { CardActions, LockFields, LockedNote } from './CardActions';
import { MIXED, MIXED_SWATCH, isMixed, type Mixed } from './selectionModel';
import './props.css';
import './rooms.css';
import './selection-card.css';
import './lighting.css';
import './labels.css';

/*
 * The v2 label card (board T3): the text, the style and its look, the angle, and whether
 * players see it. A label placed a moment ago opens with its text field focused and the
 * placeholder selected, so typing replaces it; Enter is done, Esc on the untouched
 * placeholder takes the label back. A bound label (Room name, Number pin, Door tag on its
 * target) shows what it follows and reads its text from there.
 */

type Patch = Partial<TextChild>;
/** One label of the selection, by where it lives. */
export interface LabelEntry {
  layerId: string;
  id: string;
}

function readLabel(e: LabelEntry): TextChild | undefined {
  const layer = useStore.getState().layers.find((l) => l.id === e.layerId) as DungeonLayer | undefined;
  return layer?.children.find((c): c is TextChild => c.id === e.id && c.childType === 'text');
}

function run(label: string, cmds: Command[]): void {
  if (cmds.length === 0) return;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds));
}

const keysOf = (p: Patch) => Object.keys(p) as (keyof TextChild)[];

/** `child`'s own value for every key of `patch`. */
function priorOf(child: TextChild, patch: Patch): Patch {
  const out: Record<string, unknown> = {};
  for (const k of keysOf(patch)) out[k] = structuredClone(child[k]);
  return out as Patch;
}

/** The box `patch` leaves a label with: text, size, weight and backdrop all move it. */
function withBox(child: TextChild, patch: Patch): Patch {
  const next = { ...child, ...patch };
  return { ...patch, ...measureLabel(next.text, next.fontSize, next) };
}

/**
 * The card's writes over one or several labels. A drag previews live off the undo stack and
 * lands as one step when it ends; a click or a typed value is one step at once. Every step
 * is a PropertyCommand per label, grouped when there are several.
 */
function useLabelWrites(entries: readonly LabelEntry[]) {
  const before = useRef<Map<string, Patch> | null>(null);

  const preview = (make: (c: TextChild) => Patch) => {
    const snap = before.current ?? new Map<string, Patch>();
    for (const e of entries) {
      const c = readLabel(e);
      if (!c) continue;
      const patch = make(c);
      const prior = snap.get(e.id) ?? {};
      for (const k of keysOf(patch)) if (!(k in prior)) (prior as Record<string, unknown>)[k] = structuredClone(c[k]);
      snap.set(e.id, prior);
      useStore.getState().updateChild(e.layerId, e.id, patch as Partial<AnyChild>);
    }
    before.current = snap;
  };

  const commit = (label: string) => {
    const snap = before.current;
    before.current = null;
    if (!snap) return;
    const cmds: Command[] = [];
    for (const e of entries) {
      const prior = snap.get(e.id);
      const c = readLabel(e);
      if (!prior || !c) continue;
      const after = priorOf(c, prior);
      if (JSON.stringify(after) === JSON.stringify(prior)) continue;
      // Back to the start, so the command's own execute lands the change.
      useStore.getState().updateChild(e.layerId, e.id, prior as Partial<AnyChild>);
      cmds.push(new PropertyCommand(label, { type: 'child', layerId: e.layerId, childId: e.id }, prior, after));
    }
    run(label, cmds);
  };

  const set = (label: string, make: (c: TextChild) => Patch) => {
    const cmds: Command[] = [];
    for (const e of entries) {
      const c = readLabel(e);
      if (!c) continue;
      const after = make(c);
      const prior = priorOf(c, after);
      if (JSON.stringify(after) === JSON.stringify(prior)) continue;
      cmds.push(new PropertyCommand(label, { type: 'child', layerId: e.layerId, childId: e.id }, prior, after));
    }
    run(label, cmds);
  };

  return { preview, commit, set };
}

/** One value across the labels, or MIXED where they differ. */
function common<T>(labels: readonly TextChild[], read: (c: TextChild) => T): Mixed<T> {
  const first = read(labels[0]);
  return labels.every((c) => read(c) === first) ? first : MIXED;
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="v2-rrow" data-testid={testId}>
      <span className="v2-rrow__lbl">{label}</span>
      {children}
    </div>
  );
}

function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Mixed<T>;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <span className="v2-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => value !== o.value && onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </Row>
  );
}

type Weight = 'regular' | 'bold';
type Backdrop = 'none' | 'halo' | 'pill';
type Align = 'left' | 'centre' | 'right';

const WEIGHTS: { value: Weight; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'bold', label: 'Bold' },
];
const BACKDROPS: { value: Backdrop; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'halo', label: 'Halo' },
  { value: 'pill', label: 'Pill' },
];
const ALIGNS: { value: Align; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'centre', label: 'Centre' },
  { value: 'right', label: 'Right' },
];
const STYLE_OPTIONS = LABEL_STYLES.map((s) => ({ value: s.id ?? 'custom', label: s.name }));

const fmtSize = (v: number) => v.toFixed(1);
const fmtSq = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const clampSize = (v: number) => Math.min(LABEL_SIZE_RANGE.max, Math.max(LABEL_SIZE_RANGE.min, Math.round(v * 10) / 10));

/** Size, Colour, Weight, Backdrop and Align: what one label and several share. */
function LookFields({ labels, writes }: { labels: readonly TextChild[]; writes: ReturnType<typeof useLabelWrites> }) {
  const { preview, commit, set } = writes;
  const size = common(labels, (c) => c.fontSize);
  const color = common(labels, (c) => c.color);
  const weight = common<Weight>(labels, (c) => (c.weight === 'bold' ? 'bold' : 'regular'));
  const backdrop = common<Backdrop>(labels, (c) => c.backdrop ?? 'none');
  const align = common<Align>(labels, (c) => c.align ?? 'centre');
  const sizePatch = (v: number) => (c: TextChild) => withBox(c, { fontSize: clampSize(v) });
  return (
    <>
      <Row label="Size" testId="v2-label-size">
        <span className="v2-pscale">
          <RangeInput
            label="Size"
            value={isMixed(size) ? LABEL_SIZE_RANGE.min : size}
            {...LABEL_SIZE_RANGE}
            onChange={(v) => preview(sizePatch(v))}
            onCommit={() => commit('Label size')}
          />
          <NumBox label="" title="Size" value={size} format={fmtSize} unit="sq" onCommit={(v) => set('Label size', sizePatch(v))} />
        </span>
      </Row>
      <div className="v2-rrow v2-selc">
        <ColorCtl
          label="Colour"
          placement="beside"
          value={isMixed(color) ? MIXED_SWATCH : color}
          onChange={(c) => preview(() => ({ color: c }))}
          onCommit={() => commit('Label colour')}
        />
        <span className="v2-selc__value v2-num">{isMixed(color) ? 'Mixed' : color.toUpperCase()}</span>
      </div>
      <SegRow<Weight>
        label="Weight"
        value={weight}
        options={WEIGHTS}
        onChange={(v) => set('Label weight', (c) => withBox(c, { weight: v === 'bold' ? 'bold' : undefined }))}
      />
      <SegRow<Backdrop>
        label="Backdrop"
        value={backdrop}
        options={BACKDROPS}
        onChange={(v) => set('Label backdrop', (c) => withBox(c, { backdrop: v === 'none' ? undefined : v }))}
      />
      <SegRow<Align>
        label="Align"
        value={align}
        options={ALIGNS}
        onChange={(v) => set('Label align', () => ({ align: v === 'centre' ? undefined : v }))}
      />
    </>
  );
}

function PlayersRow({ labels, writes }: { labels: readonly TextChild[]; writes: ReturnType<typeof useLabelWrites> }) {
  const players = common(labels, (c) => c.players === true);
  return (
    <div className="v2-rrow v2-prow--tight">
      <span className="v2-rrow__lbl v2-prow__wide">Visible to players</span>
      <CardSwitch
        label="Visible to players"
        checked={players}
        onChange={(v) => writes.set('Visible to players', () => ({ players: v ? true : undefined }))}
      />
    </div>
  );
}

/** What a bound label follows, by name, live. */
function useFollowing(label: TextChild): string | null {
  return useStore((s) => {
    const b = label.bound;
    if (!b) return null;
    for (const l of s.layers) {
      if (l.type !== 'dungeon') continue;
      const layer = l as DungeonLayer;
      if (b.kind === 'room') {
        const room = layer.rooms?.find((r) => r.id === b.id);
        if (room) return room.name || 'a room';
      } else {
        const door = layer.children.find((c) => c.id === b.id && c.childType === 'door');
        if (door) return door.name || 'a door';
      }
    }
    return null;
  });
}

/** The text field: autogrows from two rows to five; one undo step per visit. */
function TextField({ label, layerId, readOnly }: { label: TextChild; layerId: string; readOnly: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const atFocus = useRef<Patch | null>(null);
  /** The label went away under the field (Esc took it back): nothing to commit. */
  const gone = useRef(false);
  const rows = Math.min(5, Math.max(2, label.text.split('\n').length));

  // Once, for the label just placed: the field takes the typing with the placeholder selected.
  // A bound label's field takes focus too (its text selected), so Enter is done either way.
  useLayoutEffect(() => {
    if (!takeLabelFocus(label.id)) return;
    const el = ref.current;
    if (!el) return;
    const take = () => {
      el.focus();
      el.select();
    };
    take();
    // The canvas press that placed the label mounts this card during its pointerdown; the
    // mousedown after it moves focus to the page (the canvas cannot hold focus). Take it
    // straight back when focus went nowhere, during that press only (until the next frame),
    // so keys typed at once land here. No cleanup: Strict Mode's remount must not drop it.
    const regain = (e: FocusEvent) => {
      el.removeEventListener('blur', regain);
      if (e.relatedTarget !== null) return;
      queueMicrotask(() => {
        if (el.isConnected && (document.activeElement === null || document.activeElement === document.body)) take();
      });
    };
    el.addEventListener('blur', regain);
    requestAnimationFrame(() => el.removeEventListener('blur', regain));
    // Mount-only on purpose: a later render never takes focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    const prior = atFocus.current;
    atFocus.current = null;
    if (!prior || gone.current) return;
    const c = readLabel({ layerId, id: label.id });
    if (!c || c.text === prior.text) return;
    const after = { text: c.text, width: c.width, height: c.height };
    useStore.getState().updateChild(layerId, label.id, prior as Partial<AnyChild>);
    undoManager.execute(new PropertyCommand('Edit label', { type: 'child', layerId, childId: label.id }, prior, after));
  };

  return (
    <textarea
      ref={ref}
      className="v2-field v2-ltext"
      aria-label="Label text"
      data-testid="v2-label-text"
      value={label.text}
      rows={rows}
      readOnly={readOnly}
      spellCheck={false}
      onFocus={() => {
        if (readOnly) return;
        gone.current = false;
        atFocus.current = { text: label.text, width: label.width, height: label.height };
      }}
      onChange={(e) => {
        if (readOnly) return;
        const c = readLabel({ layerId, id: label.id });
        if (c) useStore.getState().updateChild(layerId, label.id, withBox(c, { text: e.target.value }) as Partial<AnyChild>);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        // Keys typed here are not canvas shortcuts.
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          const c = readLabel({ layerId, id: label.id });
          if (c && removeFreshLabel(c)) {
            gone.current = true;
            atFocus.current = null;
            return;
          }
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The whole card for one label. */
export function LabelTargetCard({ label, layerId }: { label: TextChild; layerId: string }) {
  const entries = useMemo(() => [{ layerId, id: label.id }], [layerId, label.id]);
  const writes = useLabelWrites(entries);
  const following = useFollowing(label);
  const locked = !!label.locked;
  const bound = !!label.bound;
  const deg = Math.round((label.rotation * 180) / Math.PI);
  const box = getChildBounds(label);

  const pickStyle = (id: string) => {
    const style = labelStyle(id === 'custom' ? undefined : (id as LabelStyleId));
    writes.set('Label style', (c) => {
      const s = useStore.getState();
      const layer = s.layers.find((l) => l.id === layerId) as DungeonLayer | undefined;
      const look = styleLook(style, layer?.style.wallColor ?? c.color);
      const target = style.binds ? findBindTarget(style.binds, c.position, s.layers, layerId) : null;
      const { text, ...bind } = bindingFields(style.id, c.position, target);
      return withBox(c, { ...look, ...bind, ...(text !== undefined ? { text } : {}) });
    });
  };

  return (
    <section
      className="v2-sel v2-float v2-pcard v2-lcard v2-labelcard"
      data-testid="v2-selection-card"
      data-keys="canvas"
      data-chrome
      aria-label="Selection"
    >
      <header className="v2-sel__head v2-pcard__head">
        <span className="v2-sel__name">{label.name || 'Label'}</span>
        <span className="v2-sel__kind v2-rend" data-testid="v2-sel-kind">
          {locked ? 'Label · locked' : 'Label'}
        </span>
      </header>
      <CardActions />
      {locked && <LockedNote />}
      <LockFields locked={locked}>
        <div className="v2-sel__dims">
          <div className="v2-field">
            <span>W</span>
            <span className="v2-num">{fmtSq(box.width)} sq</span>
          </div>
          <div className="v2-field">
            <span>H</span>
            <span className="v2-num">{fmtSq(box.height)} sq</span>
          </div>
        </div>
        <Section title="Text" testId="v2-label-text-section">
          <TextField key={label.id} label={label} layerId={layerId} readOnly={bound} />
          {bound && (
            <div className="v2-rrow v2-lbound" data-testid="v2-label-bound">
              <span className="v2-rquiet">
                Follows <b>{following ?? 'nothing'}</b>
              </span>
              <button
                type="button"
                className="v2-link v2-rend"
                onClick={() => writes.set('Unbind label', () => ({ bound: undefined, offset: undefined }))}
              >
                Unbind
              </button>
            </div>
          )}
        </Section>

        <Section title="Style" testId="v2-label-style-section">
          <Row label="Style">
            <select
              className="v2-field v2-rselect"
              aria-label="Style"
              value={label.style ?? 'custom'}
              onChange={(e) => pickStyle(e.target.value)}
            >
              {STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          <LookFields labels={[label]} writes={writes} />
          <Row label="Angle">
            <NumBox
              label=""
              title="Angle"
              value={deg}
              format={(v) => String(Math.round(v))}
              unit="°"
              className="v2-rfield--narrow"
              onCommit={(v) => writes.set('Label angle', () => ({ rotation: (Math.round(v) * Math.PI) / 180 }))}
            />
          </Row>
        </Section>

        <Section title="Visibility" tight testId="v2-label-visibility">
          <PlayersRow labels={[label]} writes={writes} />
        </Section>
      </LockFields>
    </section>
  );
}

/** The fields several labels share, for the mixed card: Size, Colour, Weight, Backdrop, Align, players. */
export function LabelGroupFields({ entries }: { entries: readonly LabelEntry[] }) {
  const writes = useLabelWrites(entries);
  const labels = useStore(
    useShallow((s) => {
      const out: TextChild[] = [];
      for (const e of entries) {
        const layer = s.layers.find((l) => l.id === e.layerId) as DungeonLayer | undefined;
        const c = layer?.children.find((x): x is TextChild => x.id === e.id && x.childType === 'text');
        if (c) out.push(c);
      }
      return out;
    }),
  );
  if (labels.length === 0) return null;
  return (
    <div className="v2-lcard v2-labelgroup" data-testid="v2-label-group">
      <Section title="Labels" testId="v2-label-group-look">
        <LookFields labels={labels} writes={writes} />
        <PlayersRow labels={labels} writes={writes} />
      </Section>
    </div>
  );
}
