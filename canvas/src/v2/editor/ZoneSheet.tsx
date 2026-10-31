import { useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronRight, ImagePlus, Plus, X } from 'lucide-react';
import { isValidFormula } from '@dnd/core/src/shared/dice-format';
import { roomIndexOf } from '@dnd/core/src/shared/roomIndex';
import { conditionZoneId, roomLabel } from '@dnd/core/src/shared/prep';
import { getEntriesByType } from '@dnd/core/src/assets/packCatalog';
import { useStore } from '@/store/store';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { importNoteImage } from '@/canvas/importImage';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { TIMES, WEATHERS, vocabLabel } from '@/store/types';
import type {
  Ability,
  AnyChild,
  DungeonLayer,
  LightChild,
  MonsterEntry,
  RoomNote,
  TimeOfDay,
  TriggerAction,
  TriggerCondition,
  TriggerDef,
  Weather,
  ZoneChild,
  ZoneShape,
} from '@/store/types';
import { CONDITION_LABELS } from './prepModel';
import { Seg, Select, Switch } from './controls';
import { LockedNote } from './CardActions';
import './layer-sheet.css';
import './rooms.css';
import './selection-card.css';
import './zone-sheet.css';

/*
 * The Zone sheet (board T6): everything a zone carries as prep, in the layer sheet's plain
 * sections. Name, its shape, the explore lock, its triggers with their actions, and its
 * notes with their images. Text fields write when they lose focus; a pick writes at once.
 * The zone's own fields (name, radius, the lock) are undo steps; triggers and notes are
 * prep, which sits outside the undo stack, so a delete asks twice.
 */

const ZONE_CONDITIONS: Record<ZoneShape['kind'], TriggerCondition['kind'][]> = {
  point: ['room-revealed'],
  circle: ['enter-region', 'within-radius'],
  rect: ['enter-region'],
};

const ABILITIES: { value: Ability; label: string }[] = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => ({
  value: a,
  label: a.toUpperCase(),
}));

const ACTION_KINDS: { value: TriggerAction['kind']; label: string }[] = [
  { value: 'show-text', label: 'Show text' },
  { value: 'light', label: 'Light' },
  { value: 'trap', label: 'Trap' },
  { value: 'ability-check', label: 'Ability check' },
  { value: 'prompt', label: 'Prompt' },
  { value: 'environment', label: 'Environment' },
  { value: 'encounter', label: 'Encounter' },
];

const SIZES: { value: NonNullable<MonsterEntry['size']>; label: string }[] = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'huge', label: 'Huge' },
  { value: 'gargantuan', label: 'Gargantuan' },
];

const PROMPTS: { value: 'initiative' | 'attack'; label: string }[] = [
  { value: 'initiative', label: 'Initiative' },
  { value: 'attack', label: 'Attack' },
];

const TIME_CHOICES: { value: TimeOfDay | ''; label: string }[] = [
  { value: '', label: 'Unchanged' },
  ...TIMES.map((t) => ({ value: t, label: vocabLabel(t) })),
];
const WEATHER_CHOICES: { value: Weather | ''; label: string }[] = [
  { value: '', label: 'Unchanged' },
  ...WEATHERS.map((w) => ({ value: w, label: vocabLabel(w) })),
];

/** A fresh action of `kind`, the way the v1 sheet starts one. */
function defaultAction(kind: TriggerAction['kind'], firstLightId: string): TriggerAction {
  switch (kind) {
    case 'show-text':
      return { kind, text: '', toPlayers: true };
    case 'light':
      return { kind, lightId: firstLightId, on: true };
    case 'trap':
      return { kind, text: '' };
    case 'ability-check':
      return { kind, ability: 'str', dc: 10, text: '' };
    case 'prompt':
      return { kind, prompt: 'initiative' };
    case 'environment':
      return { kind };
    case 'encounter':
      return {
        kind,
        name: 'Encounter',
        monsters: [{ id: crypto.randomUUID(), name: 'Goblin', count: 1 }],
        spawn: true,
        seedInitiative: true,
      };
  }
}

/** An action turned into another kind: only its `text` carries over, the rest starts fresh. */
function changeActionKind(action: TriggerAction, kind: TriggerAction['kind'], firstLightId: string): TriggerAction {
  const next = defaultAction(kind, firstLightId);
  const text = (action as { text?: string }).text;
  return text && 'text' in next ? { ...next, text } : next;
}

/* ── Writes, always from what the store holds now ───────── */

function writeTrigger(id: string, fn: (t: TriggerDef) => TriggerDef): void {
  const s = useStore.getState();
  const t = s.prep?.triggers.find((x) => x.id === id);
  if (t) s.upsertTrigger(fn(t));
}

function writeAction(triggerId: string, index: number, fn: (a: TriggerAction) => TriggerAction): void {
  writeTrigger(triggerId, (t) => ({ ...t, actions: t.actions.map((a, i) => (i === index ? fn(a) : a)) }));
}

function writeNote(id: string, fn: (n: RoomNote) => RoomNote): void {
  const s = useStore.getState();
  const n = s.prep?.notes.find((x) => x.id === id);
  if (n) s.upsertNote(fn(n));
}

/** Drops a removed note image from the file unless a sibling note still holds it. */
function releaseImage(noteId: string, key: string): void {
  const s = useStore.getState();
  const held = (s.prep?.notes ?? []).some((n) => n.id !== noteId && n.imageKeys.includes(key));
  if (!held) s.removeCustomImage(key);
}

/* ── Fields ─────────────────────────────────────────────── */

/** A one-line field holding a draft while focused; writes on blur when it changed, Esc puts it back. */
function TextField({
  label,
  value,
  onCommit,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      className={cn('v2-field v2-lsheet__input', className)}
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={() => {
        cancelled.current = false;
        setDraft(value);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft;
        setDraft(null);
        if (cancelled.current || next === null || next === value) return;
        onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A few lines of text, written when the field loses focus. */
function TextArea({ label, value, onCommit, rows = 2 }: { label: string; value: string; onCommit: (v: string) => void; rows?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <textarea
      className="v2-kta"
      aria-label={label}
      rows={rows}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft;
        setDraft(null);
        if (next !== null && next !== value) onCommit(next);
      }}
    />
  );
}

/** A number in a cell: written on Enter or blur, clamped to its range; Esc puts it back. */
function NumField({
  label,
  title,
  value,
  min,
  max,
  step = 1,
  unit,
  onCommit,
}: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = text ?? String(Math.round(value * 100) / 100);
  return (
    <label className="v2-field v2-selc__num v2-zsheet__num">
      <span>{label}</span>
      <input
        type="number"
        className="v2-num"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={title}
        onFocus={() => {
          cancelled.current = false;
          setText(shown);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text ?? '');
          setText(null);
          if (cancelled.current || !Number.isFinite(v)) return;
          const next = Math.min(max, Math.max(min, v));
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      {unit && <span className="v2-zsheet__unit">{unit}</span>}
    </label>
  );
}

/**
 * A dice formula (damage, HP). A draft that does not parse is never written: the field keeps
 * showing it, marked, with the format under it.
 */
function FormulaField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onCommit: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // The list is keyed by index: a removed sibling rebinds this field to another value.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(null);
  }
  const shown = draft ?? value ?? '';
  const valid = shown.trim() === '' || isValidFormula(shown.trim());
  return (
    <span className="v2-zsheet__formula">
      <input
        className="v2-field v2-lsheet__input v2-num"
        aria-label={label}
        aria-invalid={!valid || undefined}
        value={shown}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={() => setDraft(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!valid) return;
          const t = shown.trim();
          setDraft(null);
          const next = t === '' ? undefined : t;
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {!valid && <span className="v2-lsheet__note">Format: NdM or NdM±K, e.g. 2d6+1</span>}
    </span>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="v2-lsheet__row">
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

/** Two clicks to delete prep: the first arms the button for a few seconds. */
function useArmedDelete() {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(id);
    timer.current = setTimeout(() => setArmed(null), 4000);
  };
  const disarm = () => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(null);
  };
  return { armed, arm, disarm };
}

function DeleteButton({
  name,
  armed,
  onArm,
  onConfirm,
  onDisarm,
}: {
  name: string;
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  onDisarm: () => void;
}) {
  return armed ? (
    <button type="button" className="v2-zsheet__confirm" aria-label={`Confirm delete ${name}`} onClick={onConfirm} onBlur={onDisarm}>
      Delete?
    </button>
  ) : (
    <button type="button" className="v2-kx" aria-label={`Delete ${name}`} data-tip="Delete" onClick={onArm}>
      <X size={12} strokeWidth={2} />
    </button>
  );
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="v2-lsheet__sec" data-testid={testId}>
      <h3 className="v2-lsheet__head">{title}</h3>
      {children}
    </section>
  );
}

/* ── The sheet ──────────────────────────────────────────── */

function shapeReadout(shape: ZoneShape): string {
  const n = (v: number) => v.toFixed(1);
  switch (shape.kind) {
    case 'point':
      return `Point · ${n(shape.position.x)}, ${n(shape.position.y)}`;
    case 'circle':
      return `Circle · ${n(shape.position.x)}, ${n(shape.position.y)} · radius ${n(shape.radius)} sq`;
    case 'rect':
      return `Rect · ${n(shape.x)}, ${n(shape.y)} · ${n(shape.width)} × ${n(shape.height)} sq`;
  }
}

export function ZoneSheet({ layerId, zoneId }: { layerId: string; zoneId: string }) {
  const { zone, layer } = useStore(
    useShallow((s) => {
      const l = s.layers.find((x) => x.id === layerId);
      if (!l || l.type !== 'dungeon') return { zone: null, layer: null };
      const c = (l as DungeonLayer).children.find((x) => x.id === zoneId);
      if (!c || c.childType !== 'zone') return { zone: null, layer: null };
      return { zone: c as ZoneChild, layer: l as DungeonLayer };
    }),
  );
  const triggers = useStore(useShallow((s) => (s.prep?.triggers ?? []).filter((t) => conditionZoneId(t.when) === zoneId)));
  const notes = useStore(useShallow((s) => (s.prep?.notes ?? []).filter((n) => n.zoneId === zoneId)));
  // Which triggers and notes are unfolded, by id: adding one opens it and leaves the rest as they are.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const del = useArmedDelete();

  if (!zone || !layer) return null;

  const shape = zone.shape;
  const locked = !!zone.locked || !!layer.locked;
  // Only a point zone binds to a room: a room-revealed trigger on a pin outside every room never fires.
  const room = shape.kind === 'point' ? roomIndexOf(layer.rooms ?? []).roomAt(shape.position.x, shape.position.y) : null;
  const isOrphan = shape.kind === 'point' && !room;

  const update = (label: string, before: Partial<ZoneChild>, after: Partial<ZoneChild>) =>
    undoManager.execute(new UpdateChildCommand(label, layerId, zoneId, before as Partial<AnyChild>, after as Partial<AnyChild>));

  const toggle = (id: string) =>
    setOpenIds((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const unfold = (id: string) => setOpenIds((o) => new Set(o).add(id));

  const addTrigger = () => {
    const trigger: TriggerDef = {
      id: crypto.randomUUID(),
      name: `Trigger ${triggers.length + 1}`,
      when: { kind: ZONE_CONDITIONS[shape.kind][0], zoneId } as TriggerCondition,
      actions: [],
      once: true,
      enabled: true,
    };
    useStore.getState().upsertTrigger(trigger);
    unfold(trigger.id);
  };

  const addNote = () => {
    const note: RoomNote = {
      id: crypto.randomUUID(),
      zoneId,
      title: `Note ${notes.length + 1}`,
      body: '',
      imageKeys: [],
      showOnReveal: false,
    };
    useStore.getState().upsertNote(note);
    unfold(note.id);
  };

  // A deleted note's images leave the file with it, unless a sibling note holds one too.
  const deleteNote = (note: RoomNote) => {
    for (const key of note.imageKeys) releaseImage(note.id, key);
    useStore.getState().removeNote(note.id);
  };

  return (
    <div className="v2-lsheet v2-zsheet" data-testid="v2-zone-sheet-body">
      {locked && <LockedNote />}
      <fieldset className="v2-zsheet__set" disabled={locked}>
        <Section title="Name">
          <TextField
            label="Zone name"
            value={zone.name}
            onCommit={(v) => {
              const name = v.trim();
              if (name && name !== zone.name) update('Rename zone', { name: zone.name }, { name });
            }}
          />
        </Section>

        <Section title="Shape" testId="v2-zone-shape">
          <span className="v2-zsheet__readout v2-num">{shapeReadout(shape)}</span>
          {isOrphan ? (
            <span className="v2-rtag v2-zsheet__tag">Not inside a room</span>
          ) : (
            room && <span className="v2-rtag v2-zsheet__tag">Inside {roomLabel(room) || 'a room'}</span>
          )}
        </Section>

        {shape.kind !== 'point' && (
          <section className="v2-lsheet__sec">
            <SwitchRow
              label="Blocks auto-explore"
              checked={zone.blocksAutoExplore ?? false}
              onChange={(v) => update('Zone explore lock', { blocksAutoExplore: zone.blocksAutoExplore }, { blocksAutoExplore: v })}
            />
            <p className="v2-lsheet__note">The party still sees inside; auto-explore never marks it, so you reveal it by hand.</p>
          </section>
        )}

        <Section title="Triggers" testId="v2-zone-triggers">
          {triggers.length === 0 && <p className="v2-lsheet__empty">No triggers on this zone.</p>}
          {triggers.map((t) => (
            <div key={t.id} className="v2-zsheet__item" role="group" aria-label={t.name} data-testid="v2-zone-trigger">
              <div className="v2-zsheet__itemhead">
                <button type="button" className="v2-selc__disclose v2-zsheet__disclose" aria-expanded={openIds.has(t.id)} onClick={() => toggle(t.id)}>
                  <ChevronRight size={12} strokeWidth={2} aria-hidden />
                  <span className="v2-zsheet__itemname">{t.name}</span>
                </button>
                {!t.enabled && <span className="v2-rtag">Off</span>}
                <span className="v2-rquiet v2-zsheet__cond">{CONDITION_LABELS[t.when.kind]}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.enabled}
                  aria-label="Enabled"
                  data-tip={t.enabled ? 'Enabled' : 'Off'}
                  className={cn('v2-switch', t.enabled && 'v2-switch--on')}
                  onClick={() => writeTrigger(t.id, (x) => ({ ...x, enabled: !x.enabled }))}
                >
                  <span />
                </button>
                <DeleteButton
                  name={t.name}
                  armed={del.armed === t.id}
                  onArm={() => del.arm(t.id)}
                  onDisarm={del.disarm}
                  onConfirm={() => {
                    del.disarm();
                    useStore.getState().removeTrigger(t.id);
                  }}
                />
              </div>
              {openIds.has(t.id) && <TriggerEditor trigger={t} zone={zone} layer={layer} onRadius={(r, prev) => update('Zone shape', { shape: prev }, { shape: r })} />}
            </div>
          ))}
          <button type="button" className="v2-rbtn v2-zsheet__add" onClick={addTrigger}>
            <Plus size={14} strokeWidth={1.75} aria-hidden />
            Add trigger
          </button>
        </Section>

        <Section title="Notes" testId="v2-zone-notes">
          {notes.length === 0 && <p className="v2-lsheet__empty">No notes on this zone.</p>}
          {notes.map((n) => (
            <div key={n.id} className="v2-zsheet__item" role="group" aria-label={n.title || 'Untitled note'} data-testid="v2-zone-note">
              <div className="v2-zsheet__itemhead">
                <button type="button" className="v2-selc__disclose v2-zsheet__disclose" aria-expanded={openIds.has(n.id)} onClick={() => toggle(n.id)}>
                  <ChevronRight size={12} strokeWidth={2} aria-hidden />
                  <span className="v2-zsheet__itemname">{n.title || 'Untitled note'}</span>
                </button>
                {n.showOnReveal && <span className="v2-rtag">Pops</span>}
                <DeleteButton
                  name={n.title || 'note'}
                  armed={del.armed === n.id}
                  onArm={() => del.arm(n.id)}
                  onDisarm={del.disarm}
                  onConfirm={() => {
                    del.disarm();
                    deleteNote(n);
                  }}
                />
              </div>
              {openIds.has(n.id) && <NoteEditor note={n} isOrphan={isOrphan} />}
            </div>
          ))}
          <button type="button" className="v2-rbtn v2-zsheet__add" onClick={addNote}>
            <Plus size={14} strokeWidth={1.75} aria-hidden />
            Add note
          </button>
        </Section>
      </fieldset>
    </div>
  );
}

/* ── A trigger ──────────────────────────────────────────── */

function TriggerEditor({
  trigger,
  zone,
  layer,
  onRadius,
}: {
  trigger: TriggerDef;
  zone: ZoneChild;
  layer: DungeonLayer;
  onRadius: (next: ZoneShape, prev: ZoneShape) => void;
}) {
  const lights = layer.children.filter((c): c is LightChild => c.childType === 'light');
  const firstLightId = lights[0]?.id ?? '';
  const shape = zone.shape;
  const kinds = ZONE_CONDITIONS[shape.kind];
  const options = (kinds.includes(trigger.when.kind) ? kinds : [...kinds, trigger.when.kind]).map((k) => ({
    value: k,
    label: CONDITION_LABELS[k],
  }));
  const id = trigger.id;

  return (
    <div className="v2-zsheet__body">
      <TextField label="Trigger name" value={trigger.name} onCommit={(v) => writeTrigger(id, (t) => ({ ...t, name: v }))} />
      <Select
        label="Condition"
        value={trigger.when.kind}
        options={options}
        onChange={(k) =>
          writeTrigger(id, (t) => ({ ...t, when: { kind: k, zoneId: conditionZoneId(t.when) ?? '' } as TriggerCondition }))
        }
      />
      {trigger.when.kind === 'within-radius' && shape.kind === 'circle' && (
        <div className="v2-zsheet__radius" data-testid="v2-zone-trigger-radius">
          <NumField
            label="Radius"
            title="Trigger radius"
            value={shape.radius}
            min={0.5}
            max={100}
            step={0.1}
            unit="sq"
            onCommit={(r) => onRadius({ ...shape, radius: r }, shape)}
          />
          <span className="v2-lsheet__note">The zone’s own radius: every trigger on it shares it.</span>
        </div>
      )}
      <SwitchRow label="Once" checked={trigger.once} onChange={(v) => writeTrigger(id, (t) => ({ ...t, once: v }))} />

      <div className="v2-zsheet__acts">
        <span className="v2-zsheet__sub">Actions</span>
        {trigger.actions.length === 0 && <p className="v2-lsheet__note">Nothing happens yet.</p>}
        {trigger.actions.map((a, i) => (
          <ActionEditor key={`${i}:${a.kind}`} triggerId={id} index={i} action={a} lights={lights} firstLightId={firstLightId} />
        ))}
        <button
          type="button"
          className="v2-rbtn v2-rbtn--ghost v2-zsheet__add"
          onClick={() => writeTrigger(id, (t) => ({ ...t, actions: [...t.actions, defaultAction('show-text', firstLightId)] }))}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          Add action
        </button>
      </div>
    </div>
  );
}

/* ── An action ──────────────────────────────────────────── */

function ActionEditor({
  triggerId,
  index,
  action,
  lights,
  firstLightId,
}: {
  triggerId: string;
  index: number;
  action: TriggerAction;
  lights: LightChild[];
  firstLightId: string;
}) {
  const set = (fn: (a: TriggerAction) => TriggerAction) => writeAction(triggerId, index, fn);
  // Every write below patches the action the store holds now, as the kind it is.
  const patch = <K extends TriggerAction['kind']>(p: Partial<Extract<TriggerAction, { kind: K }>>) =>
    set((a) => ({ ...a, ...p }) as TriggerAction);

  return (
    <div className="v2-zsheet__act" data-testid="v2-zone-action">
      <div className="v2-zsheet__acthead">
        <Select
          label="Kind"
          value={action.kind}
          options={ACTION_KINDS}
          onChange={(k) => set((a) => changeActionKind(a, k, firstLightId))}
        />
        <button
          type="button"
          className="v2-kx"
          aria-label="Remove action"
          data-tip="Remove action"
          onClick={() => writeTrigger(triggerId, (t) => ({ ...t, actions: t.actions.filter((_, i) => i !== index) }))}
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>

      {action.kind === 'show-text' && (
        <>
          <TextArea label="Text" value={action.text} onCommit={(text) => patch<'show-text'>({ text })} />
          <SwitchRow label="Show to players" checked={action.toPlayers} onChange={(toPlayers) => patch<'show-text'>({ toPlayers })} />
        </>
      )}

      {action.kind === 'light' && (
        <>
          <Select
            label="Light"
            value={action.lightId}
            options={lights.length > 0 ? lights.map((l) => ({ value: l.id, label: l.name })) : [{ value: action.lightId, label: 'No lights on this layer' }]}
            onChange={(lightId) => patch<'light'>({ lightId })}
          />
          {/* An empty id (the layer had no lights) is just as inert as a deleted light. */}
          {!lights.some((l) => l.id === action.lightId) && <span className="v2-rtag v2-zsheet__tag">Light not found: trigger is inert</span>}
          <SwitchRow label="Turn light on" checked={action.on} onChange={(on) => patch<'light'>({ on })} />
          <SwitchRow label="Show to players" checked={action.toPlayers ?? true} onChange={(toPlayers) => patch<'light'>({ toPlayers })} />
        </>
      )}

      {action.kind === 'trap' && (
        <>
          <TextArea label="Text" value={action.text} onCommit={(text) => patch<'trap'>({ text })} />
          <SwitchRow
            label="Save"
            checked={!!action.save}
            onChange={(v) => patch<'trap'>({ save: v ? { ability: 'str', dc: 10 } : undefined })}
          />
          {action.save && (
            <div className="v2-zsheet__pair">
              <Seg
                label="Ability"
                value={action.save.ability}
                options={ABILITIES}
                onChange={(ability) => set((a) => (a.kind === 'trap' && a.save ? { ...a, save: { ...a.save, ability } } : a))}
              />
              <NumField
                label="DC"
                title="Save DC"
                value={action.save.dc}
                min={1}
                max={30}
                onCommit={(dc) => set((a) => (a.kind === 'trap' && a.save ? { ...a, save: { ...a.save, dc } } : a))}
              />
            </div>
          )}
          <FormulaField label="Damage" value={action.damage} placeholder="Damage, e.g. 2d6+1" onCommit={(damage) => patch<'trap'>({ damage })} />
        </>
      )}

      {action.kind === 'ability-check' && (
        <>
          <div className="v2-zsheet__pair">
            <Seg label="Ability" value={action.ability} options={ABILITIES} onChange={(ability) => patch<'ability-check'>({ ability })} />
            <NumField label="DC" title="Check DC" value={action.dc} min={1} max={30} onCommit={(dc) => patch<'ability-check'>({ dc })} />
          </div>
          <TextArea label="Text" value={action.text} onCommit={(text) => patch<'ability-check'>({ text })} />
        </>
      )}

      {action.kind === 'prompt' && (
        <>
          <Seg label="Prompt" value={action.prompt} options={PROMPTS} onChange={(prompt) => patch<'prompt'>({ prompt })} />
          <TextField
            label="Prompt note"
            value={action.text ?? ''}
            placeholder="Optional note"
            onCommit={(v) => patch<'prompt'>({ text: v || undefined })}
          />
          <p className="v2-lsheet__note">DM log only, not shown at the table.</p>
        </>
      )}

      {action.kind === 'environment' && (
        <>
          <Select
            label="Time"
            value={action.time ?? ''}
            options={TIME_CHOICES}
            onChange={(v) => patch<'environment'>({ time: (v || undefined) as TimeOfDay | undefined })}
          />
          <Select
            label="Weather"
            value={action.weather ?? ''}
            options={WEATHER_CHOICES}
            onChange={(v) => patch<'environment'>({ weather: (v || undefined) as Weather | undefined })}
          />
        </>
      )}

      {action.kind === 'encounter' && <EncounterFields action={action} set={set} />}
    </div>
  );
}

function EncounterFields({
  action,
  set,
}: {
  action: Extract<TriggerAction, { kind: 'encounter' }>;
  set: (fn: (a: TriggerAction) => TriggerAction) => void;
}) {
  // Installed-pack token art; the pack list re-renders this once packs finish loading.
  useStore((s) => s.packs.installedPacks);
  const tokenArt = getEntriesByType('token');
  const artOptions = [{ value: '', label: 'Placeholder disc' }, ...tokenArt.map((e) => ({ value: e.id, label: e.label }))];
  const enc = (fn: (a: Extract<TriggerAction, { kind: 'encounter' }>) => TriggerAction) =>
    set((a) => (a.kind === 'encounter' ? fn(a) : a));
  const setMonster = (id: string, p: Partial<MonsterEntry>) =>
    enc((a) => ({ ...a, monsters: a.monsters.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  return (
    <>
      <TextField label="Encounter name" value={action.name} onCommit={(name) => enc((a) => ({ ...a, name }))} />
      <span className="v2-zsheet__sub">Monsters</span>
      {action.monsters.length === 0 && <span className="v2-rtag v2-zsheet__tag">No monsters: trigger is inert</span>}
      {action.monsters.map((m) => (
        <div key={m.id} className="v2-zsheet__monster" data-testid="v2-zone-monster">
          <div className="v2-zsheet__line">
            <TextField label="Monster name" className="v2-zsheet__grow" value={m.name} onCommit={(name) => setMonster(m.id, { name })} />
            <NumField label="×" title="Count" value={m.count} min={1} max={20} onCommit={(count) => setMonster(m.id, { count })} />
            <button
              type="button"
              className="v2-kx"
              aria-label={`Remove ${m.name || 'monster'}`}
              onClick={() => enc((a) => ({ ...a, monsters: a.monsters.filter((x) => x.id !== m.id) }))}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
          <div className="v2-zsheet__pair">
            <Select label="Size" value={m.size ?? 'medium'} options={SIZES} onChange={(size) => setMonster(m.id, { size })} />
            <FormulaField label="HP formula" value={m.hp} placeholder="HP, e.g. 2d6" onCommit={(hp) => setMonster(m.id, { hp })} />
          </div>
          {/* One select for both halves of tokenRef; '' is the art-less placeholder. */}
          <Select
            label="Token art"
            value={m.tokenRef ? `${m.tokenRef.packId}:${m.tokenRef.assetId}` : ''}
            options={artOptions}
            onChange={(v) => {
              if (!v) return setMonster(m.id, { tokenRef: undefined });
              const [packId, ...rest] = v.split(':');
              setMonster(m.id, { tokenRef: { packId, assetId: rest.join(':') } });
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="v2-rbtn v2-rbtn--ghost v2-zsheet__add"
        onClick={() => enc((a) => ({ ...a, monsters: [...a.monsters, { id: crypto.randomUUID(), name: 'Monster', count: 1 }] }))}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden />
        Add monster
      </button>
      <SwitchRow label="Spawn tokens at the zone" checked={action.spawn} onChange={(spawn) => enc((a) => ({ ...a, spawn }))} />
      <SwitchRow
        label="Seed the initiative tracker"
        checked={action.seedInitiative}
        onChange={(seedInitiative) => enc((a) => ({ ...a, seedInitiative }))}
      />
    </>
  );
}

/* ── A note ─────────────────────────────────────────────── */

function NoteEditor({ note, isOrphan }: { note: RoomNote; isOrphan: boolean }) {
  const customImages = useStore((s) => s.assets.customImages);
  const file = useRef<HTMLInputElement>(null);
  const id = note.id;

  const addImage = async (f: File) => {
    try {
      const key = await importNoteImage(f);
      writeNote(id, (n) => ({ ...n, imageKeys: [...n.imageKeys, key] }));
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Image import failed');
    }
  };

  const removeImage = (key: string) => {
    writeNote(id, (n) => ({ ...n, imageKeys: n.imageKeys.filter((k) => k !== key) }));
    releaseImage(id, key);
  };

  return (
    <div className="v2-zsheet__body">
      <TextField label="Note title" value={note.title} onCommit={(title) => writeNote(id, (n) => ({ ...n, title }))} />
      <TextArea label="Note text" rows={4} value={note.body} onCommit={(body) => writeNote(id, (n) => ({ ...n, body }))} />
      <SwitchRow
        label="Show when room is revealed"
        checked={note.showOnReveal}
        onChange={(showOnReveal) => writeNote(id, (n) => ({ ...n, showOnReveal }))}
      />
      {note.showOnReveal && isOrphan && <span className="v2-rtag v2-zsheet__tag">Pin is not inside a room: never pops</span>}

      <span className="v2-zsheet__sub">Images</span>
      {note.imageKeys.length > 0 && (
        <div className="v2-zsheet__images">
          {note.imageKeys.map((key) => (
            <div key={key} className="v2-zsheet__image" data-testid="v2-zone-note-image">
              {customImages[key] ? <img src={customImages[key]} alt="" /> : <span className="v2-zsheet__missing">missing</span>}
              <button type="button" className="v2-zsheet__unimage" aria-label="Remove image" onClick={() => removeImage(key)}>
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="v2-rbtn v2-rbtn--ghost v2-zsheet__add" onClick={() => file.current?.click()}>
        <ImagePlus size={14} strokeWidth={1.75} aria-hidden />
        Add image
      </button>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        aria-label="Note image file"
        data-testid="v2-zone-note-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImage(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
