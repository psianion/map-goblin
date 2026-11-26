// "Your character" with none yet (plan 3.6): the characters the DM prepared, each free, taken
// or saved for a name, and "Make your own" when the DM allows it. Used in the lobby and on the
// "Pick your character" card of a started table.

import { useState } from 'react';
import { Input, PrimaryButton, SecondaryButton, cn } from '@dnd/ui';
import { Plus } from '@dnd/ui/icons';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { TokenPortrait } from '../../modules/tokens/TokenPortrait';
import { pcDefs, pcStatus, sendCommand, useRoster, useTable, type PcStatus } from './lobbyState';

function statusText(s: PcStatus): string {
  if (s.kind === 'taken') return `Taken by ${s.by}`;
  if (s.kind === 'saved') return `Saved for ${s.for}`;
  return s.kind === 'mine' ? 'Yours' : 'Free';
}

const TILE = 'flex min-h-[132px] flex-col items-center gap-1.5 rounded-float border px-2 pt-3 pb-2.5 text-center transition-[background-color,border-color,transform] duration-150';

function MakeYourOwn({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    sendCommand('tokens', 'pc-create', { name: trimmed });
    onDone();
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-float border border-line bg-panel-2 p-3"
      data-testid="lobby-make-form"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <label htmlFor="lobby-pc-name" className="text-[12px] text-text-2">
        Your character&apos;s name
      </label>
      <Input
        id="lobby-pc-name"
        autoFocus
        maxLength={60}
        value={name}
        placeholder="Wren Ashdown"
        data-testid="lobby-pc-name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="flex justify-end gap-1.5">
        <SecondaryButton type="button" onClick={onDone}>
          Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={!name.trim()} data-testid="lobby-pc-create">
          Make character
        </PrimaryButton>
      </div>
    </form>
  );
}

export function CharacterPicker() {
  const tokens = useModuleState<TokensState>('tokens');
  const players = useRoster();
  const you = useSessionStore((s) => s.you?.identityId);
  const { playersMakePcs } = useTable();
  const [making, setMaking] = useState(false);
  const pcs = pcDefs(tokens).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-3" data-testid="character-picker">
      {pcs.length === 0 && !playersMakePcs && (
        <p className="text-sm text-text-2">The DM has no characters ready yet. They will appear here.</p>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
        {pcs.map((def) => {
          const status = pcStatus(def, you, players);
          const free = status.kind === 'free';
          return (
            <li key={def.id}>
              <button
                type="button"
                disabled={!free}
                data-testid="lobby-pc"
                data-state={status.kind}
                className={cn(
                  TILE,
                  'w-full',
                  free
                    ? 'border-line bg-panel hover:border-line-strong hover:bg-panel-2 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'
                    : 'cursor-default border-line bg-panel-2 opacity-60',
                )}
                onClick={() => sendCommand('tokens', 'pc-claim', { defId: def.id })}
              >
                <TokenPortrait name={def.name} assetId={def.imageAssetId} ring={def.ring} className="size-14 text-sm" />
                <span className="line-clamp-2 text-[13px] leading-tight font-medium text-text">{def.name}</span>
                <span className="text-[11px] text-text-3">{statusText(status)}</span>
              </button>
            </li>
          );
        })}
        {playersMakePcs && !making && (
          <li>
            <button
              type="button"
              data-testid="lobby-make-own"
              className={cn(
                TILE,
                'w-full justify-center border-dashed border-line-strong text-text-2 hover:bg-panel-2 hover:text-text active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
              )}
              onClick={() => setMaking(true)}
            >
              <span className="flex size-14 items-center justify-center rounded-pill border border-dashed border-line-strong">
                <Plus aria-hidden strokeWidth={1.75} className="size-5" />
              </span>
              <span className="text-[13px] font-medium">Make your own</span>
            </button>
          </li>
        )}
        {making && (
          <li className="col-span-full">
            <MakeYourOwn onDone={() => setMaking(false)} />
          </li>
        )}
      </ul>
    </div>
  );
}
