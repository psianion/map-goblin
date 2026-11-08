// The Zone sheet (More on the zone card): everything a zone carries as prep. Name, its
// shape, the explore lock, its triggers with their actions, and its notes with their
// images. Text fields write when they lose focus; a pick writes at once. The zone's own
// fields (name, radius, the lock) are undo steps; triggers and notes are prep, which sits
// outside the undo stack, so a delete asks twice.

import { useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronRight, ImagePlus, X } from 'lucide-react';
import { isValidFormula } from '@dnd/core/src/shared/dice-format';
import { roomIndexOf } from '@dnd/core/src/shared/roomIndex';
import { conditionZoneId, roomLabel } from '@dnd/core/src/shared/prep';
import { getEntriesByType } from '@dnd/core/src/assets/packCatalog';
import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { importNoteImage } from '@/canvas/importImage';
import { notify } from '@dnd/ui/toast';
import {
  cn,
  Caption,
  IconKeyButton,
  Seg,
  SelectRow,
  SettingRow,
  SwitchRow,
  Button,
  Input,
  Switch,
} from '@dnd/ui';
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
import { CONDITION_LABELS } from '@/editor/models/prepModel';
import { AddButton, DraftArea, DraftInput, Note, RemoveButton, Tag } from './sheetFields';

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

/** "Unchanged" is the action leaving the time or weather as it is. */
const UNCHANGED = 'unchanged';
const TIME_CHOICES = [{ value: UNCHANGED, label: 'Unchanged' }, ...TIMES.map((t) => ({ value: t as string, label: vocabLabel(t) }))];
const WEATHER_CHOICES = [{ value: UNCHANGED, label: 'Unchanged' }, ...WEATHERS.map((w) => ({ value: w as string, label: vocabLabel(w) }))];
/** The token art pick's placeholder disc. */
const NO_ART = 'placeholder';

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

const wide = 'w-full';

/** A number beside its label: written on Enter or leaving, clamped to its range; Escape puts it back. */
function NumRow({
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
    <SettingRow label={label} className={wide}>
      <span className="flex items-center gap-1.5">
        <Input
          type="number"
          className="w-[72px]"
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
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
        {unit && <span className="font-mono text-[11px] text-text-3">{unit}</span>}
      </span>
    </SettingRow>
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
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <Input
        className="min-w-0 font-mono"
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
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      {!valid && <Note>Format: NdM or NdM±K, e.g. 2d6+1</Note>}
    </span>
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

function DeleteButton({ name, armed, onArm, onConfirm, onDisarm }: { name: string; armed: boolean; onArm: () => void; onConfirm: () => void; onDisarm: () => void }) {
  return armed ? (
    <Button variant="outline" size="sm" className="text-danger hover:text-danger" aria-label={`Confirm delete ${name}`} onClick={onConfirm} onBlur={onDisarm}>
      Delete?
    </Button>
  ) : (
    <IconKeyButton size={26} icon={X} label={`Delete ${name}`} data-tip="Delete" onClick={onArm} />
  );
}

function Section({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      {title && <Caption>{title}</Caption>}
      {children}
    </section>
  );
}

/** A trigger or a note: its head (disclose, name, flags, its own controls) and, unfolded, its body. */
function Item({ name, open, onToggle, head, children, testId }: { name: string; open: boolean; onToggle: () => void; head: ReactNode; children: ReactNode; testId: string }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col rounded-control border border-line" role="group" aria-label={name} data-testid={testId}>
      <div className="flex h-8 items-center gap-1.5 pr-1 pl-1">
        <button
          type="button"
          className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-control px-1 text-left text-[12px] text-text outline-none hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-focus"
          aria-expanded={open}
          onClick={onToggle}
        >
          <Chevron aria-hidden strokeWidth={2} className="size-3 shrink-0 text-text-3" />
          <span className="truncate">{name}</span>
        </button>
        {head}
      </div>
      {open && <div className="flex flex-col gap-1.5 border-t border-line px-2 pt-2 pb-2">{children}</div>}
    </div>
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

/** The zone's sheet body, found by its id; nothing when the zone has gone. */
export function ZoneSheetBody({ zoneId }: { zoneId: string }) {
  const layerId = useStore((s) => selectLayerForChild(s, zoneId)?.id ?? null);
  if (!layerId) return null;
  return <ZoneSheet layerId={layerId} zoneId={zoneId} />;
}

function ZoneSheet({ layerId, zoneId }: { layerId: string; zoneId: string }) {
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
    <div className="flex flex-col gap-3 px-3 pt-2.5 pb-3" data-testid="zone-sheet">
      {locked && (
        <p className="text-[12px] text-text-2" data-testid="zone-sheet-locked">
          Locked: unlock to edit
        </p>
      )}
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={locked}>
        <Section title="Name">
          <DraftInput
            label="Zone name"
            value={zone.name}
            onCommit={(v) => {
              const name = v.trim();
              if (name && name !== zone.name) update('Rename zone', { name: zone.name }, { name });
            }}
          />
        </Section>

        <Section title="Shape" testId="zone-shape">
          <span className="font-mono text-[11px] text-text-2">{shapeReadout(shape)}</span>
          {isOrphan ? <Tag>Not inside a room</Tag> : room && <Tag>Inside {roomLabel(room) || 'a room'}</Tag>}
        </Section>

        {shape.kind !== 'point' && (
          <Section>
            <SwitchRow
              label="Blocks auto-explore"
              className={wide}
              checked={zone.blocksAutoExplore ?? false}
              onCheckedChange={(v) => update('Zone explore lock', { blocksAutoExplore: zone.blocksAutoExplore }, { blocksAutoExplore: v })}
            />
            <Note>The party still sees inside; auto-explore never marks it, so you reveal it by hand.</Note>
          </Section>
        )}

        <Section title="Triggers" testId="zone-triggers">
          {triggers.length === 0 && <p className="text-[12px] text-text-3">No triggers on this zone.</p>}
          {triggers.map((t) => (
            <Item
              key={t.id}
              name={t.name}
              open={openIds.has(t.id)}
              onToggle={() => toggle(t.id)}
              testId="zone-trigger"
              head={
                <>
                  {!t.enabled && <Tag>Off</Tag>}
                  <span className="max-w-[88px] shrink-0 truncate text-[11px] text-text-3">{CONDITION_LABELS[t.when.kind]}</span>
                  <Switch aria-label="Enabled" data-tip={t.enabled ? 'Enabled' : 'Off'} checked={t.enabled} onCheckedChange={() => writeTrigger(t.id, (x) => ({ ...x, enabled: !x.enabled }))} />
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
                </>
              }
            >
              <TriggerEditor trigger={t} zone={zone} layer={layer} onRadius={(r, prev) => update('Zone shape', { shape: prev }, { shape: r })} />
            </Item>
          ))}
          <AddButton onClick={addTrigger}>Add trigger</AddButton>
        </Section>

        <Section title="Notes" testId="zone-notes">
          {notes.length === 0 && <p className="text-[12px] text-text-3">No notes on this zone.</p>}
          {notes.map((n) => (
            <Item
              key={n.id}
              name={n.title || 'Untitled note'}
              open={openIds.has(n.id)}
              onToggle={() => toggle(n.id)}
              testId="zone-note"
              head={
                <>
                  {n.showOnReveal && <Tag>Pops</Tag>}
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
                </>
              }
            >
              <NoteEditor note={n} isOrphan={isOrphan} />
            </Item>
          ))}
          <AddButton onClick={addNote}>Add note</AddButton>
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
    value: k as string,
    label: CONDITION_LABELS[k],
  }));
  const id = trigger.id;

  return (
    <>
      <DraftInput label="Trigger name" value={trigger.name} onCommit={(v) => writeTrigger(id, (t) => ({ ...t, name: v }))} />
      <SelectRow
        label="Condition"
        className={wide}
        value={trigger.when.kind}
        options={options}
        onValueChange={(k) => writeTrigger(id, (t) => ({ ...t, when: { kind: k, zoneId: conditionZoneId(t.when) ?? '' } as TriggerCondition }))}
      />
      {trigger.when.kind === 'within-radius' && shape.kind === 'circle' && (
        <div className="flex flex-col gap-1" data-testid="zone-trigger-radius">
          <NumRow label="Radius" title="Trigger radius" value={shape.radius} min={0.5} max={100} step={0.1} unit="sq" onCommit={(r) => onRadius({ ...shape, radius: r }, shape)} />
          <Note>The zone’s own radius: every trigger on it shares it.</Note>
        </div>
      )}
      <SwitchRow label="Once" className={wide} checked={trigger.once} onCheckedChange={(v) => writeTrigger(id, (t) => ({ ...t, once: v }))} />

      <div className="mt-1 flex flex-col gap-1.5">
        <Caption>Actions</Caption>
        {trigger.actions.length === 0 && <Note>Nothing happens yet.</Note>}
        {trigger.actions.map((a, i) => (
          <ActionEditor key={`${i}:${a.kind}`} triggerId={id} index={i} action={a} lights={lights} firstLightId={firstLightId} />
        ))}
        <AddButton onClick={() => writeTrigger(id, (t) => ({ ...t, actions: [...t.actions, defaultAction('show-text', firstLightId)] }))}>Add action</AddButton>
      </div>
    </>
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
  const patch = <K extends TriggerAction['kind']>(p: Partial<Extract<TriggerAction, { kind: K }>>) => set((a) => ({ ...a, ...p }) as TriggerAction);

  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-panel-2 p-2" data-testid="zone-action">
      <div className="flex items-center gap-1">
        <SelectRow
          label="Kind"
          className="w-auto min-w-0 flex-1"
          value={action.kind}
          options={ACTION_KINDS}
          onValueChange={(k) => set((a) => changeActionKind(a, k as TriggerAction['kind'], firstLightId))}
        />
        <RemoveButton label="Remove action" onClick={() => writeTrigger(triggerId, (t) => ({ ...t, actions: t.actions.filter((_, i) => i !== index) }))} />
      </div>

      {action.kind === 'show-text' && (
        <>
          <DraftArea label="Text" rows={2} value={action.text} onCommit={(text) => patch<'show-text'>({ text })} />
          <SwitchRow label="Show to players" className={wide} checked={action.toPlayers} onCheckedChange={(toPlayers) => patch<'show-text'>({ toPlayers })} />
        </>
      )}

      {action.kind === 'light' && (
        <>
          <SelectRow
            label="Light"
            className={wide}
            value={action.lightId}
            options={lights.length > 0 ? lights.map((l) => ({ value: l.id, label: l.name })) : [{ value: action.lightId, label: 'No lights on this layer' }]}
            onValueChange={(lightId) => patch<'light'>({ lightId })}
          />
          {/* An empty id (the layer had no lights) is just as inert as a deleted light. */}
          {!lights.some((l) => l.id === action.lightId) && <Tag>Light not found: trigger is inert</Tag>}
          <SwitchRow label="Turn light on" className={wide} checked={action.on} onCheckedChange={(on) => patch<'light'>({ on })} />
          <SwitchRow label="Show to players" className={wide} checked={action.toPlayers ?? true} onCheckedChange={(toPlayers) => patch<'light'>({ toPlayers })} />
        </>
      )}

      {action.kind === 'trap' && (
        <>
          <DraftArea label="Text" rows={2} value={action.text} onCommit={(text) => patch<'trap'>({ text })} />
          <SwitchRow label="Save" className={wide} checked={!!action.save} onCheckedChange={(v) => patch<'trap'>({ save: v ? { ability: 'str', dc: 10 } : undefined })} />
          {action.save && (
            <>
              <Seg
                aria-label="Ability"
                value={action.save.ability}
                options={ABILITIES}
                onValueChange={(ability) => set((a) => (a.kind === 'trap' && a.save ? { ...a, save: { ...a.save, ability: ability as Ability } } : a))}
              />
              <NumRow
                label="DC"
                title="Save DC"
                value={action.save.dc}
                min={1}
                max={30}
                onCommit={(dc) => set((a) => (a.kind === 'trap' && a.save ? { ...a, save: { ...a.save, dc } } : a))}
              />
            </>
          )}
          <FormulaField label="Damage" value={action.damage} placeholder="Damage, e.g. 2d6+1" onCommit={(damage) => patch<'trap'>({ damage })} />
        </>
      )}

      {action.kind === 'ability-check' && (
        <>
          <Seg aria-label="Ability" value={action.ability} options={ABILITIES} onValueChange={(ability) => patch<'ability-check'>({ ability: ability as Ability })} />
          <NumRow label="DC" title="Check DC" value={action.dc} min={1} max={30} onCommit={(dc) => patch<'ability-check'>({ dc })} />
          <DraftArea label="Text" rows={2} value={action.text} onCommit={(text) => patch<'ability-check'>({ text })} />
        </>
      )}

      {action.kind === 'prompt' && (
        <>
          <Seg aria-label="Prompt" value={action.prompt} options={PROMPTS} onValueChange={(prompt) => patch<'prompt'>({ prompt: prompt as 'initiative' | 'attack' })} />
          <DraftInput label="Prompt note" value={action.text ?? ''} placeholder="Optional note" onCommit={(v) => patch<'prompt'>({ text: v || undefined })} />
          <Note>DM log only, not shown at the table.</Note>
        </>
      )}

      {action.kind === 'environment' && (
        <>
          <SelectRow
            label="Time"
            className={wide}
            value={action.time ?? UNCHANGED}
            options={TIME_CHOICES}
            onValueChange={(v) => patch<'environment'>({ time: v === UNCHANGED ? undefined : (v as TimeOfDay) })}
          />
          <SelectRow
            label="Weather"
            className={wide}
            value={action.weather ?? UNCHANGED}
            options={WEATHER_CHOICES}
            onValueChange={(v) => patch<'environment'>({ weather: v === UNCHANGED ? undefined : (v as Weather) })}
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
  const artOptions = [{ value: NO_ART, label: 'Placeholder disc' }, ...tokenArt.map((e) => ({ value: e.id, label: e.label }))];
  const enc = (fn: (a: Extract<TriggerAction, { kind: 'encounter' }>) => TriggerAction) => set((a) => (a.kind === 'encounter' ? fn(a) : a));
  const setMonster = (id: string, p: Partial<MonsterEntry>) => enc((a) => ({ ...a, monsters: a.monsters.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  return (
    <>
      <DraftInput label="Encounter name" value={action.name} onCommit={(name) => enc((a) => ({ ...a, name }))} />
      <Caption className="mt-1">Monsters</Caption>
      {action.monsters.length === 0 && <Tag>No monsters: trigger is inert</Tag>}
      {action.monsters.map((m) => (
        <div key={m.id} className="flex flex-col gap-1.5 border-t border-line pt-1.5" data-testid="zone-monster">
          <div className="flex items-center gap-1">
            <DraftInput label="Monster name" className="flex-1" value={m.name} onCommit={(name) => setMonster(m.id, { name })} />
            <CountField value={m.count} onCommit={(count) => setMonster(m.id, { count })} />
            <RemoveButton label={`Remove ${m.name || 'monster'}`} onClick={() => enc((a) => ({ ...a, monsters: a.monsters.filter((x) => x.id !== m.id) }))} />
          </div>
          <div className="flex items-start gap-1">
            <SelectRow label="Size" className="w-auto min-w-0 flex-1" value={m.size ?? 'medium'} options={SIZES} onValueChange={(size) => setMonster(m.id, { size: size as MonsterEntry['size'] })} />
            <FormulaField label="HP formula" value={m.hp} placeholder="HP, e.g. 2d6" onCommit={(hp) => setMonster(m.id, { hp })} />
          </div>
          {/* One pick for both halves of tokenRef; the placeholder disc is no art. */}
          <SelectRow
            label="Token art"
            className={wide}
            value={m.tokenRef ? `${m.tokenRef.packId}:${m.tokenRef.assetId}` : NO_ART}
            options={artOptions}
            onValueChange={(v) => {
              if (v === NO_ART) return setMonster(m.id, { tokenRef: undefined });
              const [packId, ...rest] = v.split(':');
              setMonster(m.id, { tokenRef: { packId, assetId: rest.join(':') } });
            }}
          />
        </div>
      ))}
      <AddButton onClick={() => enc((a) => ({ ...a, monsters: [...a.monsters, { id: crypto.randomUUID(), name: 'Monster', count: 1 }] }))}>Add monster</AddButton>
      <SwitchRow label="Spawn tokens at the zone" className={wide} checked={action.spawn} onCheckedChange={(spawn) => enc((a) => ({ ...a, spawn }))} />
      <SwitchRow label="Seed the initiative tracker" className={wide} checked={action.seedInitiative} onCheckedChange={(seedInitiative) => enc((a) => ({ ...a, seedInitiative }))} />
    </>
  );
}

/** A monster's count, 1 to 20, written on Enter or leaving. */
function CountField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <DraftInput
      label="Count"
      mono
      className="w-10 min-w-10"
      value={String(value)}
      selectOnFocus
      onCommit={(t) => {
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return;
        const next = Math.min(20, Math.max(1, v));
        if (next !== value) onCommit(next);
      }}
    />
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
    <>
      <DraftInput label="Note title" value={note.title} onCommit={(title) => writeNote(id, (n) => ({ ...n, title }))} />
      <DraftArea label="Note text" rows={4} value={note.body} onCommit={(body) => writeNote(id, (n) => ({ ...n, body }))} />
      <SwitchRow label="Show when room is revealed" className={wide} checked={note.showOnReveal} onCheckedChange={(showOnReveal) => writeNote(id, (n) => ({ ...n, showOnReveal }))} />
      {note.showOnReveal && isOrphan && <Tag>Pin is not inside a room: never pops</Tag>}

      <Caption className="mt-1">Images</Caption>
      {note.imageKeys.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {note.imageKeys.map((key) => (
            <div key={key} className="relative h-11 overflow-hidden rounded-control border border-line bg-panel-2" data-testid="zone-note-image">
              {customImages[key] ? (
                <img src={customImages[key]} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center text-[10px] text-text-3">missing</span>
              )}
              <IconKeyButton size={26} icon={X} label="Remove image" className={cn('absolute top-0 right-0 bg-panel/80')} onClick={() => removeImage(key)} />
            </div>
          ))}
        </div>
      )}
      <AddButton icon={ImagePlus} onClick={() => file.current?.click()}>
        Add image
      </AddButton>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        aria-label="Note image file"
        data-testid="zone-note-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImage(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
