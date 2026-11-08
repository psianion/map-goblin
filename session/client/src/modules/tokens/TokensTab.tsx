// Table v2 — the DM dock's Tokens tab (boards 12, 15). Left: what a new token starts as,
// and the table-wide actions. Right: the library strip with its filter chips and search;
// drag a tile onto the map to place it (Alt places it hidden), or click it to arm
// click-to-place. "New token" opens the Token type sheet.

import { useMemo, useState } from 'react';
import { AddTile, Caption, Chip, Input, SecondaryButton, SelectRow, Tile } from '@dnd/ui';
import { EyeOff, Eye, Lock, Users } from '@dnd/ui/icons';
import type { TableState } from '@dnd/mechanics/table';
import type { Disposition, HpVisibility, Nameplate, TokenSize, TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { openSheet } from '../../shell/sheets/registry';
import { TOKEN_DEF_DRAG, lastMapPoint, useTokenInteraction } from './drag';
import {
  DISPOSITION_LABEL,
  HP_LABEL,
  KIND_LABEL,
  NAMEPLATE_LABEL,
  SIZE_LABEL,
  filterLibrary,
  kindOf,
  placedCounts,
  sceneTokens,
  sendTokens,
  tableFlags,
  useNewTokenDefaults,
  type LibraryFilter,
} from './play';
import { usePreppedEncounters } from './prepped';
import { TokenPortrait } from './TokenPortrait';

const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

/** The active scene's tokens, defaults filled. */
function useSceneTokens() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  return useMemo(() => sceneTokens(state, sceneId), [state, sceneId]);
}

export function TokensBody() {
  const defaults = useNewTokenDefaults();
  const tokens = useSceneTokens();
  const table = tableFlags(useModuleState<TableState>('table'));
  const selectedId = useTokenInteraction((s) => s.selectedId);

  const npcs = tokens.filter((t) => kindOf(t) !== 'pc');
  const hide = (ids: string[], hidden: boolean) => ids.forEach((id) => sendTokens('hide', { id, hidden }));
  const party = tokens.filter((t) => kindOf(t) === 'pc');
  const gather = () => {
    const anchor = tokens.find((t) => t.id === selectedId) ?? lastMapPoint();
    if (!anchor || party.length === 0) return;
    sendTokens('gather', { targets: party.map((t) => t.id), x: anchor.x, y: anchor.y });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="tokens-body">
      <Caption>New tokens</Caption>
      <div className="flex flex-col gap-px">
        <SelectRow label="Size" value={defaults.size} options={options(SIZE_LABEL)} onValueChange={(v) => defaults.set({ size: v as TokenSize })} />
        <SelectRow
          label="Disposition"
          value={defaults.disposition}
          options={options(DISPOSITION_LABEL)}
          onValueChange={(v) => defaults.set({ disposition: v as Disposition })}
        />
        <SelectRow
          label="Nameplate"
          value={defaults.nameplate}
          options={options(NAMEPLATE_LABEL)}
          onValueChange={(v) => defaults.set({ nameplate: v as Nameplate })}
        />
        <SelectRow label="HP bar" value={defaults.showHp} options={options(HP_LABEL)} onValueChange={(v) => defaults.set({ showHp: v as HpVisibility })} />
      </div>
      <Caption className="mt-1">On the map</Caption>
      <div className="flex flex-wrap gap-1.5">
        <SecondaryButton icon={EyeOff} data-testid="tokens-hide-npcs" disabled={npcs.length === 0} onClick={() => hide(npcs.filter((t) => !t.hidden).map((t) => t.id), true)}>
          Hide all NPCs
        </SecondaryButton>
        <SecondaryButton icon={Eye} data-testid="tokens-show-all" disabled={!tokens.some((t) => t.hidden)} onClick={() => hide(tokens.filter((t) => t.hidden).map((t) => t.id), false)}>
          Show all
        </SecondaryButton>
        <SecondaryButton icon={Users} data-testid="tokens-gather" disabled={party.length === 0} onClick={gather}>
          Gather party
        </SecondaryButton>
        <SecondaryButton
          icon={Lock}
          active={table.movementLocked}
          data-testid="tokens-lock-movement"
          onClick={() => useSessionStore.getState().sendCommand('table', 'lock-movement', { on: !table.movementLocked })}
        >
          {table.movementLocked ? 'Movement locked' : 'Lock movement'}
        </SecondaryButton>
      </div>
    </div>
  );
}

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pc', label: 'PCs' },
  { id: 'npc', label: 'NPCs' },
  { id: 'monster', label: 'Monsters' },
  { id: 'prepped', label: 'Prepped' },
];

export function TokensStrip() {
  const state = useModuleState<TokensState>('tokens');
  const tokens = useSceneTokens();
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const placingDefId = useTokenInteraction((s) => s.placingDefId);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const defs = filterLibrary(state?.library, filter, search);
  const counts = placedCounts(tokens);
  const prepped = usePreppedEncounters(filter === 'prepped');

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2" data-testid="tokens-strip">
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <Chip key={f.id} pressed={filter === f.id} data-testid={`tokens-filter-${f.id}`} onPressedChange={() => setFilter(f.id)}>
            {f.label}
          </Chip>
        ))}
        <Input
          className="ml-auto w-40"
          placeholder="Search tokens"
          aria-label="Search tokens"
          data-testid="tokens-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {filter === 'prepped' ? (
          prepped.length === 0 ? (
            <p className="text-xs text-text-3">No room on this scene keys an encounter.</p>
          ) : (
            prepped.map((p) => (
              <div key={p.roomId} className="flex w-40 shrink-0 flex-col gap-1 rounded-control border border-line p-2" data-testid="prepped-encounter">
                <span className="truncate text-xs font-medium text-text">{p.label}</span>
                <span className="line-clamp-2 text-xs text-text-3">{p.roster}</span>
                <SecondaryButton
                  className="self-start"
                  disabled={!!p.inert}
                  title={p.inert}
                  data-testid="prepped-spawn"
                  onClick={() => useSessionStore.getState().sendCommand('triggers', 'spawn-encounter', { sceneId, roomId: p.roomId })}
                >
                  Spawn
                </SecondaryButton>
              </div>
            ))
          )
        ) : (
          <>
            {defs.map((def) => (
              <Tile
                key={def.id}
                name={def.name}
                active={placingDefId === def.id}
                draggable
                data-testid="token-tile"
                data-def={def.id}
                title={`${def.name}: drag onto the map, Alt to place hidden`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(TOKEN_DEF_DRAG, def.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={(e) => useTokenInteraction.getState().setPlacing(placingDefId === def.id ? null : def.id, e.altKey)}
                onDoubleClick={() => openSheet('token-type', { defId: def.id })}
              >
                <span className="flex size-full items-center justify-center">
                  <TokenPortrait name={def.name} assetId={def.imageAssetId} className="size-8" />
                </span>
                <span className="absolute bottom-0.5 left-0.5 rounded-key bg-panel px-1 text-xs leading-none text-text-2">{KIND_LABEL[kindOf(def)]}</span>
                {counts.get(def.id) ? (
                  <span className="absolute top-0.5 right-0.5 rounded-key bg-panel px-1 font-mono text-xs leading-none text-text-2" data-testid="token-tile-count">
                    {counts.get(def.id)}
                  </span>
                ) : null}
              </Tile>
            ))}
            <AddTile name="New token" data-testid="token-new" onClick={() => openSheet('token-type', {})} />
          </>
        )}
      </div>
    </div>
  );
}
