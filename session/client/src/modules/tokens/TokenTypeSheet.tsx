// Table v2 — the Token type sheet (board 14): a library def's whole make-up, in the right
// column. Opened from the Tokens tab's "New token" tile (blank, seeded from the tab's
// defaults) or a tile's double-click (that def). Save is one `library-upsert`; the server
// carries the def-owned fields onto every token already placed from it.

import { useState } from 'react';
import { Caption, ColourRow, InputRow, PrimaryButton, SecondaryButton, Seg, SelectRow, SwitchRow } from '@dnd/ui';
import { notify } from '@dnd/ui/toast';
import type { TokenDef, TokenKind, TokenSize, TokensState, Nameplate, HpVisibility } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { SheetFrame } from '../../shell/sheets/SheetFrame';
import { closeSheet } from '../../shell/sheets/registry';
import { HP_LABEL, KIND_LABEL, NAMEPLATE_LABEL, SIZE_LABEL, numText, parseWhole, sendTokens, useNewTokenDefaults } from './play';
import { seatColour } from '../../shell/seatColour';
import { DEFAULT_LIGHT, DEFAULT_SIGHT, mapScale, toCells, toUnits } from './sight';
import { TokenArtEditor } from './TokenArtEditor';
import { TokenPortrait } from './TokenPortrait';
import { DISPOSITION_COLOR } from './TokenRenderer';

const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

interface Draft {
  name: string;
  kind: TokenKind;
  imageAssetId: string | null;
  size: TokenSize;
  hpMax: string;
  ac: string;
  speed: string;
  passive: string;
  sightOn: boolean;
  /** In the map's units (feet on a 5 ft grid). */
  sightRange: string;
  darkvision: boolean;
  lightOn: boolean;
  lightRadius: string;
  lightColor: string;
  nameplate: Nameplate;
  showHp: HpVisibility;
  ownerIdentityId: string;
  /** Absent keeps the disposition ring (table lobby pass). */
  ring: string | undefined;
}

function draftOf(def: TokenDef | undefined, scaleValue: number, defaults: ReturnType<typeof useNewTokenDefaults.getState>): Draft {
  const units = (cells: number) => String(Number((cells * scaleValue).toFixed(2)));
  return {
    name: def?.name ?? '',
    kind: def?.kind ?? 'npc',
    imageAssetId: def?.imageAssetId ?? null,
    size: def?.size ?? defaults.size,
    hpMax: numText(def?.hp?.max),
    ac: numText(def?.ac),
    speed: numText(def?.speed),
    passive: numText(def?.passive),
    sightOn: !!def?.sight,
    sightRange: units((def?.sight ?? DEFAULT_SIGHT).range),
    darkvision: def?.sight?.visionMode === 'darkvision',
    lightOn: !!def?.light,
    lightRadius: units((def?.light ?? DEFAULT_LIGHT).dim),
    lightColor: (def?.light ?? DEFAULT_LIGHT).color,
    nameplate: def?.nameplate ?? defaults.nameplate,
    showHp: def?.showHp ?? defaults.showHp,
    ownerIdentityId: def?.ownerIdentityId ?? '',
    ring: def?.ring,
  };
}

export function TokenTypeSheet({ defId }: { defId?: string }) {
  const def = useModuleState<TokensState>('tokens')?.library?.[defId ?? ''];
  const scale = mapScale(useSessionStore((s) => s.mapData));
  const players = useSessionStore((s) => s.session?.players ?? []).filter((p) => p.role === 'player');
  const [draft, setDraft] = useState<Draft>(() => draftOf(def, scale.value, useNewTokenDefaults.getState()));
  const [editingArt, setEditingArt] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const unit = scale.unit;
  // The editor opens on the ring the map draws today: the player's seat colour for a PC with
  // a player, else the disposition's.
  const owner = players.find((p) => p.identityId === draft.ownerIdentityId);
  const seated = draft.kind === 'pc' && !!owner;
  const disposition = def?.disposition ?? (draft.kind === 'pc' ? 'friendly' : useNewTokenDefaults.getState().disposition);
  const startRing =
    draft.ring ??
    (seated ? seatColour(owner.identityId) : `#${(DISPOSITION_COLOR[disposition] ?? DISPOSITION_COLOR.neutral).toString(16).padStart(6, '0')}`);

  const save = () => {
    const name = draft.name.trim();
    if (!name) return notify.error('A token type needs a name.');
    const hpMax = parseWhole(draft.hpMax, 1, 9999);
    const range = Number(draft.sightRange);
    const radius = Number(draft.lightRadius);
    const defaults = useNewTokenDefaults.getState();
    sendTokens('library-upsert', {
      ...(defId ? { id: defId } : { disposition: draft.kind === 'pc' ? 'friendly' : defaults.disposition }),
      name,
      kind: draft.kind,
      imageAssetId: draft.imageAssetId,
      size: draft.size,
      // A new pool keeps the damage the type's tokens carry; the server works that out.
      hp: hpMax === undefined ? null : { max: hpMax, ...(def?.hp ? { current: Math.min(def.hp.current, hpMax) } : {}) },
      ac: parseWhole(draft.ac, 0, 99) ?? null,
      speed: parseWhole(draft.speed, 0, 999) ?? null,
      passive: parseWhole(draft.passive, 0, 99) ?? null,
      sight: draft.sightOn
        ? { range: toCells(Number.isFinite(range) && range >= 0 ? range : toUnits(DEFAULT_SIGHT.range, scale), scale), angle: 360, visionMode: draft.darkvision ? 'darkvision' : 'normal' }
        : null,
      light: draft.lightOn
        ? (() => {
            const dim = toCells(Number.isFinite(radius) && radius > 0 ? radius : toUnits(DEFAULT_LIGHT.dim, scale), scale);
            return { dim, bright: dim / 2, color: draft.lightColor, angle: 360 };
          })()
        : null,
      nameplate: draft.nameplate,
      showHp: draft.showHp,
      ...(draft.ring !== undefined ? { ring: draft.ring } : {}),
      ownerIdentityId: draft.kind === 'pc' && owner ? owner.identityId : null,
      ownerName: draft.kind === 'pc' && owner ? owner.name : null,
    });
    closeSheet();
  };

  return (
    <SheetFrame
      title={def ? def.name : 'New token'}
      path={['Tokens']}
      onClose={closeSheet}
      testId="token-type-sheet"
      footer={
        <div className="flex justify-end gap-1.5 border-t border-line px-3 py-2">
          <SecondaryButton onClick={closeSheet}>Cancel</SecondaryButton>
          <PrimaryButton data-testid="token-type-save" onClick={save}>
            Save
          </PrimaryButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-3 py-3">
        {editingArt ? (
          <TokenArtEditor
            name={draft.name || '?'}
            imageAssetId={draft.imageAssetId}
            ring={draft.ring}
            defaultRing={startRing}
            onCancel={() => setEditingArt(false)}
            onSave={(art) => {
              // A disposition ring nobody touched stays absent, so it follows the disposition.
              const untouched = !seated && draft.ring === undefined && art.ring === startRing;
              set({ imageAssetId: art.imageAssetId, ring: untouched ? undefined : art.ring });
              setEditingArt(false);
            }}
          />
        ) : (
          <div className="flex items-center gap-3">
            <TokenPortrait name={draft.name || '?'} assetId={draft.imageAssetId} ring={draft.ring} className="size-14" />
            <div className="flex flex-col gap-1">
              <SecondaryButton data-testid="token-type-art" onClick={() => setEditingArt(true)}>
                {draft.imageAssetId ? 'Edit picture' : 'Add a picture'}
              </SecondaryButton>
              <span className="text-xs text-text-3">Crop it into the circle and pick a ring.</span>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-px">
          <InputRow
            label="Name"
            value={draft.name}
            placeholder="Goblin"
            data-testid="token-type-name"
            onChange={(e) => set({ name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-text-2">Kind</span>
            <Seg
              aria-label="Kind"
              value={draft.kind}
              onValueChange={(v) => set({ kind: v as TokenKind })}
              options={(Object.keys(KIND_LABEL) as TokenKind[]).map((k) => ({ value: k, label: KIND_LABEL[k], testId: `token-type-kind-${k}` }))}
            />
          </div>
          {draft.kind === 'pc' && (
            <SelectRow
              label="Player"
              value={draft.ownerIdentityId || 'none'}
              options={[{ value: 'none', label: 'Nobody yet' }, ...players.map((p) => ({ value: p.identityId, label: p.name }))]}
              onValueChange={(v) => set({ ownerIdentityId: v === 'none' ? '' : v })}
            />
          )}
          <SelectRow label="Size" value={draft.size} options={options(SIZE_LABEL)} onValueChange={(v) => set({ size: v as TokenSize })} />
        </div>
        <div className="flex flex-col gap-px">
          <Caption className="mb-1">Stats</Caption>
          <InputRow label="HP max" inputMode="numeric" value={draft.hpMax} data-testid="token-type-hp" onChange={(e) => set({ hpMax: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <InputRow label="AC" inputMode="numeric" value={draft.ac} data-testid="token-type-ac" onChange={(e) => set({ ac: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <InputRow label="Speed" inputMode="numeric" value={draft.speed} onChange={(e) => set({ speed: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <InputRow label="Passive Perception" inputMode="numeric" value={draft.passive} onChange={(e) => set({ passive: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="flex flex-col gap-px">
          <Caption className="mb-1">Vision</Caption>
          <SwitchRow label="Sees" checked={draft.sightOn} onCheckedChange={(sightOn) => set({ sightOn })} />
          {draft.sightOn && (
            <>
              <InputRow label={`Sight range (${unit})`} inputMode="decimal" value={draft.sightRange} onChange={(e) => set({ sightRange: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              <SwitchRow label="Darkvision" checked={draft.darkvision} onCheckedChange={(darkvision) => set({ darkvision })} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-px">
          <Caption className="mb-1">Light</Caption>
          <SwitchRow label="Carries a light" checked={draft.lightOn} onCheckedChange={(lightOn) => set({ lightOn })} />
          {draft.lightOn && (
            <>
              <InputRow label={`Radius (${unit})`} inputMode="decimal" value={draft.lightRadius} onChange={(e) => set({ lightRadius: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              <ColourRow label="Colour" value={draft.lightColor} onValueChange={(lightColor) => set({ lightColor })} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-px">
          <Caption className="mb-1">On the map</Caption>
          <SelectRow label="Nameplate" value={draft.nameplate} options={options(NAMEPLATE_LABEL)} onValueChange={(v) => set({ nameplate: v as Nameplate })} />
          <SelectRow label="HP bar" value={draft.showHp} options={options(HP_LABEL)} onValueChange={(v) => set({ showHp: v as HpVisibility })} />
        </div>
      </div>
    </SheetFrame>
  );
}
