// Test seat for the table v2 play surfaces: a session snapshot with the given module slices,
// and `sendCommand` swapped for a spy so a test drives the commands it would send.

import { vi } from 'vitest';
import { PROTOCOL_VERSION, type PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { Token, TokenDef, TokensState } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';

export const SCENE = 'scene-1';

export const DM: PlayerInfo = { identityId: 'dm', name: 'Deb', role: 'dm', connected: true };
export const BRAM: PlayerInfo = { identityId: 'p-bram', name: 'Sam', role: 'player', connected: true };
export const YARA: PlayerInfo = { identityId: 'p-yara', name: 'Ola', role: 'player', connected: false };

export function token(over: Partial<Token> = {}): Token {
  return {
    id: 't1',
    name: 'Goblin',
    imageAssetId: null,
    size: 'medium',
    disposition: 'hostile',
    sight: null,
    light: null,
    defId: null,
    x: 1.5,
    y: 1.5,
    elevation: 0,
    z: 0,
    hidden: false,
    ownerId: null,
    kind: 'monster',
    nameplate: 'hover',
    showHp: 'dm',
    conditions: [],
    effects: [],
    ...over,
  };
}

export function def(over: Partial<TokenDef> = {}): TokenDef {
  return {
    id: 'd1',
    name: 'Goblin',
    imageAssetId: null,
    size: 'medium',
    disposition: 'hostile',
    sight: null,
    light: null,
    kind: 'monster',
    nameplate: 'hover',
    showHp: 'dm',
    conditions: [],
    effects: [],
    ...over,
  };
}

export function tokensState(tokens: Token[], library: TokenDef[] = []): TokensState {
  return {
    library: Object.fromEntries(library.map((d) => [d.id, d])),
    byScene: { [SCENE]: Object.fromEntries(tokens.map((t) => [t.id, t])) },
  };
}

/** Seats `you` at a table holding `modules`; returns the `sendCommand` spy. */
export function seat(modules: Record<string, unknown>, you: PlayerInfo = DM, players: PlayerInfo[] = [DM, BRAM, YARA]) {
  const sendCommand = vi.fn();
  useSessionStore.setState({
    you,
    token: 'test-token',
    session: {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 's',
      campaignId: 'c',
      activeSceneId: SCENE,
      scenes: [{ id: SCENE, name: 'Web Gallery', mapId: 'm' }],
      players,
      modules,
    },
    sendCommand,
  });
  return sendCommand;
}

/** The commands a spy saw, as `[module, action, payload]`. */
export const sent = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((c) => [c[0], c[1], c[2]]);
