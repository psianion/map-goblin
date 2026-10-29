import { useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useStore } from '@/store/store';
import { roomKeyOf } from '@dnd/core/src/shared/prep';
import type { Ability, CheckEntry, MonsterEntry, RoomKey, TrapEntry } from '@/store/types';
import { cn } from '@/lib/utils';
import { currentKey, writeRoomKey } from './roomActions';

/*
 * The room key (board 6): the rooms sheet's second page for one room. Read-aloud, DM
 * notes, an encounter, treasure, traps and checks: the classic module entry, all DM-only
 * prep. Each field writes the key when it loses focus, one undo step per field edit;
 * adding or removing a row is a step of its own.
 *
 * A new row starts empty: what a field is for is its placeholder, never a value, so typing
 * into a fresh row never lands after a word nobody wrote. The short number fields (count,
 * DC) do hold a value from the start; they select it on focus, so typing replaces it.
 */

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SIZES: { value: NonNullable<MonsterEntry['size']>; label: string }[] = [
  { value: 'tiny', label: 'T' },
  { value: 'small', label: 'S' },
  { value: 'medium', label: 'M' },
  { value: 'large', label: 'L' },
  { value: 'huge', label: 'H' },
  { value: 'gargantuan', label: 'G' },
];

/** Keys typed in the key editor stay out of the canvas shortcuts. */
const keepKeys = (e: React.KeyboardEvent) => e.stopPropagation();

/** A field that holds a draft while focused and writes on blur when it changed. */
function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      const next = draft;
      setDraft(null);
      if (next !== null && next !== value) commit(next);
    },
  };
}

function KeyArea({ label, value, onCommit, rows = 3 }: { label: string; value: string; onCommit: (v: string) => void; rows?: number }) {
  const field = useDraft(value, onCommit);
  return <textarea className="v2-kta" aria-label={label} rows={rows} spellCheck {...field} onKeyDown={keepKeys} />;
}

function KeyInput({
  label,
  value,
  onCommit,
  mono,
  className,
  autoFocus,
  placeholder,
  selectOnFocus,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  mono?: boolean;
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  /** Select the whole value on focus, so typing replaces it (the count, a DC). */
  selectOnFocus?: boolean;
}) {
  const field = useDraft(value, onCommit);
  // The click that focused the field would put the caret back and undo the selection.
  const keepSelection = useRef(false);
  return (
    <label className={cn('v2-kf', mono && 'v2-kf--mono', className)}>
      <input
        aria-label={label}
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        {...field}
        onFocus={(e) => {
          field.onFocus();
          if (!selectOnFocus) return;
          e.currentTarget.select();
          keepSelection.current = true;
        }}
        onMouseUp={(e) => {
          if (!keepSelection.current) return;
          keepSelection.current = false;
          e.preventDefault();
        }}
        onKeyDown={(e) => {
          keepKeys(e);
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

function KeySelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <span className="v2-ksel">
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} onKeyDown={keepKeys}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} strokeWidth={2} aria-hidden />
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="v2-kx" aria-label={label} onClick={onClick}>
      <X size={12} strokeWidth={2} />
    </button>
  );
}

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
    <div className="v2-key" data-testid="v2-room-key">
      <div className="v2-ksec v2-ksec--first">
        <div className="v2-kfl">
          Read-aloud<span className="v2-kq">players see it only when you Share</span>
        </div>
        <KeyArea label="Read-aloud" value={key.readAloud} rows={4} onCommit={(v) => writeRoomKey(roomId, { readAloud: v })} />
      </div>

      <div className="v2-ksec">
        <div className="v2-kfl">DM notes</div>
        <KeyArea label="DM notes" value={key.notes} onCommit={(v) => writeRoomKey(roomId, { notes: v })} />
      </div>

      <div className="v2-ksec" data-testid="v2-key-encounter">
        <div className="v2-kfl">
          Encounter<span className="v2-kq">Spawn at the table drops tokens here</span>
        </div>
        <div className="v2-krow">
          <KeyInput
            label="Encounter name"
            className="v2-kf--grow"
            value={enc.name}
            placeholder="Name"
            onCommit={(v) => patchEncounter(roomId, (e) => ({ ...e, name: v }))}
          />
        </div>
        {enc.monsters.map((m) => (
          <div className="v2-krow" key={m.id} data-testid="v2-key-monster">
            <KeyInput
              label="Monster name"
              className="v2-kf--grow"
              value={m.name}
              placeholder="Monster"
              autoFocus={fresh === m.id}
              onCommit={(v) => setMonster(m.id, { name: v })}
            />
            <KeyInput
              label="Count"
              mono
              className="v2-kf--count"
              value={`x${m.count}`}
              selectOnFocus
              onCommit={(v) => setMonster(m.id, { count: countOf(v, m.count) })}
            />
            <KeyInput
              label="HP formula"
              mono
              className="v2-kf--hp"
              value={m.hp ?? ''}
              placeholder="HP"
              onCommit={(v) => setMonster(m.id, { hp: v.trim() || undefined })}
            />
            <KeySelect
              label="Size"
              value={m.size ?? 'medium'}
              options={SIZES}
              onChange={(size) => setMonster(m.id, { size })}
            />
            <RemoveButton
              label={`Remove ${m.name || 'monster'}`}
              onClick={() => patchEncounter(roomId, (e) => ({ ...e, monsters: e.monsters.filter((x) => x.id !== m.id) }))}
            />
          </div>
        ))}
        <button
          type="button"
          className="v2-kadd"
          onClick={() => {
            const id = crypto.randomUUID();
            setFresh(id);
            patchEncounter(roomId, (e) => ({ ...e, monsters: [...e.monsters, { id, name: '', count: 1, size: 'medium' }] }));
          }}
        >
          Add monster
        </button>
      </div>

      <div className="v2-ksec">
        <div className="v2-kfl">Treasure</div>
        <KeyArea label="Treasure" value={key.treasure} rows={2} onCommit={(v) => writeRoomKey(roomId, { treasure: v })} />
      </div>

      <div className="v2-ksec" data-testid="v2-key-traps">
        <div className="v2-kfl">Traps and hazards</div>
        {key.traps.map((t) => (
          <div className="v2-krow" key={t.id} data-testid="v2-key-trap">
            <KeyInput
              label="Trap"
              className="v2-kf--grow"
              value={t.text}
              placeholder="What it is"
              autoFocus={fresh === t.id}
              onCommit={(v) => setTrap(t.id, { text: v })}
            />
            <KeySelect
              label="Save"
              value={t.save?.ability ?? ''}
              options={[{ value: '', label: '—' }, ...ABILITIES.map((a) => ({ value: a, label: a.toUpperCase() }))]}
              onChange={(a) => setTrap(t.id, { save: a ? { ability: a as Ability, dc: t.save?.dc ?? 12 } : undefined })}
            />
            <KeyInput
              label="Save DC"
              mono
              className="v2-kf--dc"
              value={t.save ? String(t.save.dc) : ''}
              placeholder="DC"
              selectOnFocus
              onCommit={(v) => {
                const dc = parseInt(v, 10);
                if (Number.isFinite(dc)) setTrap(t.id, { save: { ability: t.save?.ability ?? 'dex', dc } });
              }}
            />
            <KeyInput
              label="Damage"
              mono
              className="v2-kf--dmg"
              value={t.damage ?? ''}
              placeholder="Dmg"
              onCommit={(v) => setTrap(t.id, { damage: v.trim() || undefined })}
            />
            <RemoveButton label="Remove trap" onClick={() => patchList(roomId, 'traps', (rows) => rows.filter((x) => x.id !== t.id))} />
          </div>
        ))}
        <button
          type="button"
          className="v2-kadd"
          onClick={() => {
            const id = crypto.randomUUID();
            setFresh(id);
            patchList(roomId, 'traps', (rows) => [...rows, { id, text: '' }]);
          }}
        >
          Add trap
        </button>
      </div>

      <div className="v2-ksec" data-testid="v2-key-checks">
        <div className="v2-kfl">Checks</div>
        {key.checks.map((c) => (
          <div className="v2-krow" key={c.id} data-testid="v2-key-check">
            <KeySelect
              label="Ability"
              value={c.ability}
              options={ABILITIES.map((a) => ({ value: a, label: a.toUpperCase() }))}
              onChange={(ability) => setCheck(c.id, { ability })}
            />
            <KeyInput
              label="Check DC"
              mono
              className="v2-kf--dc"
              value={String(c.dc)}
              selectOnFocus
              onCommit={(v) => {
                const dc = parseInt(v, 10);
                if (Number.isFinite(dc)) setCheck(c.id, { dc });
              }}
            />
            <KeyInput
              label="Check"
              className="v2-kf--grow"
              value={c.text}
              placeholder="What it finds"
              autoFocus={fresh === c.id}
              onCommit={(v) => setCheck(c.id, { text: v })}
            />
            <RemoveButton label="Remove check" onClick={() => patchList(roomId, 'checks', (rows) => rows.filter((x) => x.id !== c.id))} />
          </div>
        ))}
        <button
          type="button"
          className="v2-kadd"
          onClick={() => {
            const id = crypto.randomUUID();
            setFresh(id);
            patchList(roomId, 'checks', (rows) => [...rows, { id, ability: 'wis', dc: 10, text: '' }]);
          }}
        >
          Add check
        </button>
      </div>
    </div>
  );
}
