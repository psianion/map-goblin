// The room key: the Rooms sheet's second page for one room. Read-aloud, DM notes, an
// encounter, treasure, traps and checks: the classic module entry, all DM-only prep. Each
// field writes the key when it loses focus, one undo step per field edit; adding or
// removing a row is a step of its own.
//
// A new row starts empty: what a field is for is its placeholder, never a value, so typing
// into a fresh row never lands after a word nobody wrote. The short number fields (count,
// DC) do hold a value from the start; they select it on focus, so typing replaces it.

import { useState, type ReactNode } from 'react';
import { useStore } from '@/store/store';
import { roomKeyOf } from '@dnd/core/src/shared/prep';
import type { Ability, CheckEntry, MonsterEntry, RoomKey, TrapEntry } from '@/store/types';
import { Caption } from '@/editor/components';
import { currentKey, writeRoomKey } from '@/editor/models/roomActions';
import { AddButton, DraftArea, DraftInput, MiniSelect, RemoveButton } from './sheetFields';

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_OPTIONS = ABILITIES.map((a) => ({ value: a, label: a.toUpperCase() }));
const SAVE_OPTIONS: { value: Ability | 'none'; label: string }[] = [{ value: 'none', label: 'No save' }, ...ABILITY_OPTIONS];
const SIZES: { value: NonNullable<MonsterEntry['size']>; label: string }[] = [
  { value: 'tiny', label: 'T' },
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'huge', label: 'H' },
  { value: 'gargantuan', label: 'G' },
];

/** Rewrite one list of the key from what the store holds now, not from a render's copy. */
function patchList<K extends 'traps' | 'checks'>(roomId: string, list: K, fn: (rows: RoomKey[K]) => RoomKey[K]): void {
  const key = currentKey(roomId);
  writeRoomKey(roomId, { [list]: fn(key[list]) } as Partial<RoomKey>);
}

function patchEncounter(roomId: string, fn: (enc: NonNullable<RoomKey['encounter']>) => NonNullable<RoomKey['encounter']>): void {
  const key = currentKey(roomId);
  writeRoomKey(roomId, { encounter: fn(key.encounter ?? { name: '', monsters: [] }) });
}

const countOf = (raw: string, fallback: number) => {
  const n = parseInt(raw.replace(/^x/i, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-baseline gap-2">
        <Caption>{title}</Caption>
        {hint && <span className="min-w-0 truncate text-[11px] text-text-3">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const line = 'flex items-center gap-1';

export function RoomKeyEditor({ roomId }: { roomId: string }) {
  const stored = useStore((s) => roomKeyOf(s.prep, roomId));
  const key: RoomKey = stored ?? { roomId, readAloud: '', notes: '', treasure: '', traps: [], checks: [] };
  const enc = key.encounter ?? { name: '', monsters: [] };
  // The row just added takes focus, so a new monster can be named straight away.
  const [fresh, setFresh] = useState<string | null>(null);

  const setMonster = (id: string, patch: Partial<MonsterEntry>) =>
    patchEncounter(roomId, (e) => ({ ...e, monsters: e.monsters.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const setTrap = (id: string, patch: Partial<TrapEntry>) =>
    patchList(roomId, 'traps', (rows) => rows.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const setCheck = (id: string, patch: Partial<CheckEntry>) =>
    patchList(roomId, 'checks', (rows) => rows.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-3 px-3 pt-2.5 pb-3" data-testid="room-key-editor">
      <Section title="Read-aloud" hint="Players see it only when you Share">
        <DraftArea label="Read-aloud" value={key.readAloud} rows={4} onCommit={(v) => writeRoomKey(roomId, { readAloud: v })} />
      </Section>

      <Section title="DM notes">
        <DraftArea label="DM notes" value={key.notes} onCommit={(v) => writeRoomKey(roomId, { notes: v })} />
      </Section>

      <Section title="Encounter" hint="Spawn at the table drops tokens here" testId="room-key-encounter">
        <DraftInput label="Encounter name" value={enc.name} placeholder="Name" onCommit={(v) => patchEncounter(roomId, (e) => ({ ...e, name: v }))} />
        {enc.monsters.map((m) => (
          <div className={line} key={m.id} data-testid="room-key-monster">
            <DraftInput
              label="Monster name"
              className="flex-1"
              value={m.name}
              placeholder="Monster"
              autoFocus={fresh === m.id}
              onCommit={(v) => setMonster(m.id, { name: v })}
            />
            <DraftInput label="Count" mono className="w-10 min-w-10" value={`x${m.count}`} selectOnFocus onCommit={(v) => setMonster(m.id, { count: countOf(v, m.count) })} />
            <DraftInput label="HP formula" mono className="w-14 min-w-14" value={m.hp ?? ''} placeholder="HP" onCommit={(v) => setMonster(m.id, { hp: v.trim() || undefined })} />
            <MiniSelect label="Size" value={m.size ?? 'medium'} options={SIZES} onChange={(size) => setMonster(m.id, { size })} />
            <RemoveButton
              label={`Remove ${m.name || 'monster'}`}
              onClick={() => patchEncounter(roomId, (e) => ({ ...e, monsters: e.monsters.filter((x) => x.id !== m.id) }))}
            />
          </div>
        ))}
        <AddButton
          onClick={() => {
            const id = crypto.randomUUID();
            setFresh(id);
            patchEncounter(roomId, (e) => ({ ...e, monsters: [...e.monsters, { id, name: '', count: 1, size: 'medium' }] }));
          }}
        >
          Add monster
        </AddButton>
      </Section>

      <Section title="Treasure">
        <DraftArea label="Treasure" value={key.treasure} rows={2} onCommit={(v) => writeRoomKey(roomId, { treasure: v })} />
      </Section>

      <Section title="Traps and hazards" testId="room-key-traps">
        {key.traps.map((t) => (
          <div className={line} key={t.id} data-testid="room-key-trap">
            <DraftInput label="Trap" className="flex-1" value={t.text} placeholder="What it is" autoFocus={fresh === t.id} onCommit={(v) => setTrap(t.id, { text: v })} />
            <MiniSelect
              label="Save"
              value={t.save?.ability ?? 'none'}
              options={SAVE_OPTIONS}
              onChange={(a) => setTrap(t.id, { save: a !== 'none' ? { ability: a, dc: t.save?.dc ?? 12 } : undefined })}
            />
            <DraftInput
              label="Save DC"
              mono
              className="w-10 min-w-10"
              value={t.save ? String(t.save.dc) : ''}
              placeholder="DC"
              selectOnFocus
              onCommit={(v) => {
                const dc = parseInt(v, 10);
                if (Number.isFinite(dc)) setTrap(t.id, { save: { ability: t.save?.ability ?? 'dex', dc } });
              }}
            />
            <DraftInput label="Damage" mono className="w-14 min-w-14" value={t.damage ?? ''} placeholder="Dmg" onCommit={(v) => setTrap(t.id, { damage: v.trim() || undefined })} />
            <RemoveButton label="Remove trap" onClick={() => patchList(roomId, 'traps', (rows) => rows.filter((x) => x.id !== t.id))} />
          </div>
        ))}
        <AddButton
          onClick={() => {
            const id = crypto.randomUUID();
            setFresh(id);
            patchList(roomId, 'traps', (rows) => [...rows, { id, text: '' }]);
          }}
        >
          Add trap
        </AddButton>
      </Section>

      <Section title="Checks" testId="room-key-checks">
        {key.checks.map((c) => (
          <div className={line} key={c.id} data-testid="room-key-check">
            <MiniSelect label="Ability" value={c.ability} options={ABILITY_OPTIONS} onChange={(ability) => setCheck(c.id, { ability })} />
            <DraftInput
              label="Check DC"
              mono
              className="w-10 min-w-10"
              value={String(c.dc)}
              selectOnFocus
              onCommit={(v) => {
                const dc = parseInt(v, 10);
                if (Number.isFinite(dc)) setCheck(c.id, { dc });
              }}
            />
            <DraftInput label="Check" className="flex-1" value={c.text} placeholder="What it finds" autoFocus={fresh === c.id} onCommit={(v) => setCheck(c.id, { text: v })} />
            <RemoveButton label="Remove check" onClick={() => patchList(roomId, 'checks', (rows) => rows.filter((x) => x.id !== c.id))} />
          </div>
        ))}
        <AddButton
          onClick={() => {
            const id = crypto.randomUUID();
            setFresh(id);
            patchList(roomId, 'checks', (rows) => [...rows, { id, ability: 'wis', dc: 10, text: '' }]);
          }}
        >
          Add check
        </AddButton>
      </Section>
    </div>
  );
}
