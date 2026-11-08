// Table v2 — the token card and the group card (board 13), up beside the selection on the
// map. One token picked: its name and kind, hit points with damage and heal, AC, its
// conditions, who owns it, Hide/Show, nameplate and HP bar, Add to combat, Delete. Two or
// more (Shift+click): damage or heal all of them (half on a save), conditions to all,
// Hide/Show all, Gather, Add to combat.

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActionRow,
  Caption,
  Chip,
  FloatBox,
  IconKeyButton,
  Input,
  PanelHeader,
  SecondaryButton,
  SelectRow,
  SwitchRow,
  cn,
} from '@dnd/ui';
import { Eye, EyeOff, LocateFixed, Pencil, ScanEye, Swords, Trash2, Users } from '@dnd/ui/icons';
import { useStore } from '@dnd/core/src/store/store';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { SIZE_CELLS, type HpVisibility, type Nameplate, type Token, type TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint, worldToScreen } from '../../renderer/camera';
import { useSightPreview } from './sightPreview';
import { useModuleState, useSessionStore } from '../../session/store';
import { openSheet } from '../../shell/sheets/registry';
import { addToCombat, notInCombat } from '../initiative/combat';
import { lastMapPoint, useTokenInteraction } from './drag';
import {
  CATALOGUE,
  HP_LABEL,
  KIND_LABEL,
  NAMEPLATE_LABEL,
  conditionLabel,
  hpDanger,
  kindOf,
  parseWhole,
  sceneTokens,
  sendTokens,
} from './play';
import { TokenPortrait } from './TokenPortrait';

const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

/** Keeps the card beside a world point as the camera moves; written straight to the node. */
function useBeside(x: number, y: number, r: number) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const step = () => {
      const el = ref.current;
      const anchor = worldToScreen(x + r, y);
      const map = document.querySelector<HTMLElement>('[data-testid="game-canvas"]')?.getBoundingClientRect();
      if (el && anchor && map) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = Math.min(Math.max(8, anchor.x + 16), map.width - w - 8);
        const top = Math.min(Math.max(56, anchor.y - h / 2), map.height - h - 8);
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [x, y, r]);
  return ref;
}

/** Damage and heal for one token or many: an amount, the two buttons, and Half on save. */
export function HpControls({ targets, testId }: { targets: Token[]; testId: string }) {
  const [amount, setAmount] = useState('');
  const [half, setHalf] = useState(false);
  const n = parseWhole(amount, 1, 9999);
  const withPool = targets.filter((t) => t.hp);
  const apply = (action: 'damage' | 'heal') => {
    if (n === undefined || withPool.length === 0) return;
    sendTokens(action, { targets: withPool.map((t) => t.id), amount: n, ...(action === 'damage' && half ? { half: true } : {}) });
    setAmount('');
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          className="w-16 font-mono"
          inputMode="numeric"
          placeholder="0"
          aria-label="Amount"
          data-testid={`${testId}-amount`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') apply('damage');
          }}
        />
        <SecondaryButton data-testid={`${testId}-damage`} disabled={n === undefined || withPool.length === 0} onClick={() => apply('damage')}>
          Damage
        </SecondaryButton>
        <SecondaryButton data-testid={`${testId}-heal`} disabled={n === undefined || withPool.length === 0} onClick={() => apply('heal')}>
          Heal
        </SecondaryButton>
      </div>
      <SwitchRow label="Half on save" checked={half} onCheckedChange={setHalf} />
    </div>
  );
}

/** The catalogue as chips: on is on for every target, a click sets it on all or off all. */
export function ConditionChips({ targets, testId }: { targets: Token[]; testId: string }) {
  const [adding, setAdding] = useState(false);
  const on = (c: string) => targets.length > 0 && targets.every((t) => t.conditions?.includes(c));
  const anyOn = CATALOGUE.filter((c) => targets.some((t) => t.conditions?.includes(c)));
  const shown = adding ? CATALOGUE : anyOn;
  const toggle = (c: string) =>
    sendTokens('set-condition', { targets: targets.map((t) => t.id), name: c, on: !on(c) });
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={`${testId}-conditions`}>
      {shown.map((c) => (
        <Chip key={c} pressed={on(c)} data-testid={`${testId}-condition-${c}`} onPressedChange={() => toggle(c)}>
          {conditionLabel(c)}
        </Chip>
      ))}
      <Chip pressed={adding} data-testid={`${testId}-condition-add`} onPressedChange={() => setAdding((v) => !v)}>
        {adding ? 'Done' : anyOn.length ? 'Add' : 'Add condition'}
      </Chip>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Caption>{title}</Caption>
      {children}
    </div>
  );
}

export function TokenCard({ token }: { token: Token }) {
  const players = useSessionStore((s) => s.session?.players ?? []).filter((p) => p.role === 'player');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const initiative = useModuleState<InitiativeState>('initiative');
  const ref = useBeside(token.x, token.y, (SIZE_CELLS[token.size] ?? 1) / 2);
  const select = useTokenInteraction((s) => s.select);
  const inFight = notInCombat([token], initiative).length === 0;
  const kind = kindOf(token);
  const preview = useSightPreview(token);
  // The map's levels: the DM moves a token between floors here (the seat that holds it follows).
  const levels = useStore((s) => s.levels);

  return (
    <FloatBox
      ref={ref}
      className="absolute z-30 flex w-72 flex-col overflow-hidden p-0"
      style={{ visibility: 'hidden' }}
      data-testid="token-card"
      data-chrome
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <PanelHeader path={['Token']} title={token.name}>
        <span className="inline-flex h-6 items-center rounded-pill border border-line px-2.5 text-xs text-text-2" data-testid="token-card-kind">
          {KIND_LABEL[kind]}
        </span>
      </PanelHeader>
      <ActionRow aria-label={`${token.name} actions`}>
        <IconKeyButton
          size={26}
          icon={token.hidden ? Eye : EyeOff}
          label={token.hidden ? 'Show to players' : 'Hide from players'}
          data-testid="token-card-hide"
          onClick={() => sendTokens('hide', { id: token.id, hidden: !token.hidden })}
        />
        {token.defId && (
          <IconKeyButton size={26} icon={Pencil} label="Edit token type" onClick={() => openSheet('token-type', { defId: token.defId })} />
        )}
        <IconKeyButton
          size={26}
          icon={Swords}
          label={inFight ? 'In the encounter' : 'Add to combat'}
          disabled={inFight}
          data-testid="token-card-add-combat"
          onClick={() => addToCombat([token], initiative, sceneId)}
        />
        <IconKeyButton
          size={26}
          icon={ScanEye}
          label={preview.reason ?? (preview.on ? 'Stop drawing its sight' : 'Draw what it can see')}
          active={preview.on && preview.reason === null}
          disabled={preview.reason !== null}
          data-testid="token-card-preview-sight"
          onClick={preview.toggle}
        />
        <IconKeyButton size={26} icon={LocateFixed} label="Frame" onClick={() => frameWorldPoint(token.x, token.y)} />
        <IconKeyButton
          size={26}
          icon={Trash2}
          label="Delete token"
          danger
          data-testid="token-card-delete"
          onClick={() => {
            sendTokens('delete', { id: token.id });
            select(null);
          }}
        />
      </ActionRow>
      <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-2.5">
          <TokenPortrait name={token.name} assetId={token.imageAssetId} className="size-10" />
          <div className="flex flex-1 flex-col">
            <span className={cn('font-mono text-sm tabular-nums', hpDanger(token) ? 'text-danger' : 'text-text')} data-testid="token-card-hp">
              {token.hp ? `${token.hp.current} / ${token.hp.max} HP` : 'No HP set'}
            </span>
            <span className="text-xs text-text-3">
              {token.ac !== undefined ? `AC ${token.ac}` : 'No AC set'}
              {token.speed !== undefined ? ` · ${token.speed} ft` : ''}
              {token.hidden ? ' · Hidden' : ''}
            </span>
          </div>
        </div>
        {token.hp && <HpControls targets={[token]} testId="token-card" />}
        <Section title="Conditions">
          <ConditionChips targets={[token]} testId="token-card" />
        </Section>
        <div className="flex flex-col gap-px">
          <SelectRow
            label="Owner"
            value={token.ownerId ?? 'none'}
            options={[{ value: 'none', label: 'The DM' }, ...players.map((p) => ({ value: p.identityId, label: p.name }))]}
            onValueChange={(v) => sendTokens('assign', { id: token.id, identityId: v === 'none' ? null : v })}
          />
          <SelectRow
            label="Nameplate"
            value={token.nameplate ?? 'hover'}
            options={options(NAMEPLATE_LABEL)}
            onValueChange={(v) => sendTokens('update', { id: token.id, nameplate: v as Nameplate })}
          />
          <SelectRow
            label="HP bar"
            value={token.showHp ?? 'dm'}
            options={options(HP_LABEL)}
            onValueChange={(v) => sendTokens('update', { id: token.id, showHp: v as HpVisibility })}
          />
          {levels.length > 1 && (
            <SelectRow
              label="Level"
              value={token.levelId ?? levels[0].id}
              options={levels.map((l) => ({ value: l.id, label: l.name }))}
              onValueChange={(levelId) => sendTokens('set-token-level', { tokenId: token.id, levelId })}
            />
          )}
        </div>
      </div>
    </FloatBox>
  );
}

export function GroupCard({ tokens }: { tokens: Token[] }) {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const initiative = useModuleState<InitiativeState>('initiative');
  const last = tokens[tokens.length - 1];
  const ref = useBeside(last.x, last.y, (SIZE_CELLS[last.size] ?? 1) / 2);
  const anyHidden = tokens.some((t) => t.hidden);
  const joining = notInCombat(tokens, initiative);
  const ids = tokens.map((t) => t.id);

  return (
    <FloatBox
      ref={ref}
      className="absolute z-30 flex w-72 flex-col overflow-hidden p-0"
      style={{ visibility: 'hidden' }}
      data-testid="group-card"
      data-chrome
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <PanelHeader path={['Tokens']} title={`${tokens.length} selected`} />
      <div className="flex flex-col gap-2.5 px-3 pt-2.5 pb-3">
        <p className="line-clamp-2 text-xs text-text-3">{tokens.map((t) => t.name).join(', ')}</p>
        <HpControls targets={tokens} testId="group-card" />
        <Section title="Conditions">
          <ConditionChips targets={tokens} testId="group-card" />
        </Section>
        <div className="flex flex-wrap gap-1.5">
          <SecondaryButton
            icon={anyHidden ? Eye : EyeOff}
            data-testid="group-card-hide"
            onClick={() => ids.forEach((id) => sendTokens('hide', { id, hidden: !anyHidden }))}
          >
            {anyHidden ? 'Show all' : 'Hide all'}
          </SecondaryButton>
          <SecondaryButton
            icon={Users}
            data-testid="group-card-gather"
            onClick={() => {
              const at = lastMapPoint() ?? last;
              sendTokens('gather', { targets: ids, x: at.x, y: at.y });
            }}
          >
            Gather
          </SecondaryButton>
          <SecondaryButton
            icon={Swords}
            disabled={joining.length === 0}
            data-testid="group-card-add-combat"
            onClick={() => addToCombat(tokens, initiative, sceneId)}
          >
            Add to combat
          </SecondaryButton>
        </div>
      </div>
    </FloatBox>
  );
}

/** A player's card: claim an unclaimed token, or see who holds it. Their own goes to the Character sheet. */
function PlayerTokenCard({ token }: { token: Token }) {
  const you = useSessionStore((s) => s.you);
  const holder = useSessionStore((s) => s.session?.players.find((p) => p.identityId === token.ownerId)?.name);
  const ref = useBeside(token.x, token.y, (SIZE_CELLS[token.size] ?? 1) / 2);
  if (token.ownerId === you?.identityId) return null;
  return (
    <FloatBox
      ref={ref}
      className="absolute z-30 flex w-56 flex-col gap-2 px-3 py-2.5"
      style={{ visibility: 'hidden' }}
      data-testid="token-card"
      data-chrome
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="truncate text-sm font-medium text-text">{token.name}</span>
      {token.ownerId === null ? (
        <SecondaryButton className="self-start" data-testid="token-card-claim" onClick={() => sendTokens('claim', { id: token.id })}>
          Claim
        </SecondaryButton>
      ) : (
        <span className="text-xs text-text-3">Held by {holder ?? 'another player'}</span>
      )}
    </FloatBox>
  );
}

/** Whichever card the selection asks for: none, one token's, or the group's. */
export function TokenCards() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const role = useSessionStore((s) => s.you?.role);
  const selectedIds = useTokenInteraction((s) => s.selectedIds);
  const draggingId = useTokenInteraction((s) => s.draggingId);
  const picked = useMemo(() => {
    const byId = new Map(sceneTokens(state, sceneId).map((t) => [t.id, t]));
    return selectedIds.flatMap((id) => {
      const t = byId.get(id);
      return t ? [t] : [];
    });
  }, [state, sceneId, selectedIds]);

  if (draggingId !== null || picked.length === 0) return null;
  if (role !== 'dm') return picked.length === 1 ? <PlayerTokenCard key={picked[0].id} token={picked[0]} /> : null;
  if (picked.length > 1) return <GroupCard tokens={picked} />;
  return <TokenCard key={picked[0].id} token={picked[0]} />;
}
