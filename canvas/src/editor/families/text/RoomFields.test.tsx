import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDungeonLayer } from '@/store/factories';
import type { Room } from '@/store/types';
import type { LookTarget } from '@/editor/models/roomLook';
import { ownLook } from '@/editor/models/roomLook';
import '@/editor/registry';
import { cards } from '@/editor/families';
import { resetViewPrefsForTests, setPreview } from '@/editor/viewPrefs';
import { PlaceSection } from './RoomFields';


const st = () => useStore.getState();
const roomT: LookTarget = { kind: 'room', layerId: 'd1', roomId: 'r1' };
const levelT = (): LookTarget => ({ kind: 'level', levelId: st().ui.activeLevelId });

function seed(map: 'outdoor' | 'indoor' | 'underground', level?: 'outdoor' | 'indoor' | 'underground') {
  const room = { id: 'r1', name: 'Hall', anchor: [2, 2] } as unknown as Room;
  const layer = { ...createDungeonLayer('Keep', st().ui.activeLevelId), id: 'd1', rooms: [room] };
  useStore.setState((s) => {
    s.layers = [layer];
    s.mapSettings.environment = map;
    s.levels.find((l) => l.id === s.ui.activeLevelId)!.look = level ? { place: level } : undefined;
  });
}

/** The section reads only its value; the registry's def and onChange are not in play. */
const with_ = (value: LookTarget) => ({ value }) as unknown as Parameters<typeof PlaceSection>[0];

const pressed = (name: RegExp) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

beforeEach(() => {
  cleanup();
  useStore.getState().resetToDefault();
});

describe('the Place section', () => {
  it('leads with Follows, chosen while nothing is pinned, and says what it inherits', () => {
    seed('outdoor');
    render(<PlaceSection {...with_(roomT)} />);
    expect(pressed(/Follows/)).toBe('true');
    expect(screen.getByTestId('look-place-source').textContent).toBe('Inherits Map');
  });

  it('pins through the look command, marks the pin and offers Reset', () => {
    seed('outdoor');
    render(<PlaceSection {...with_(roomT)} />);
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Underground/ }));
    expect(ownLook(st(), roomT)?.place).toBe('underground');
    expect(pressed(/Underground/)).toBe('true');
    expect(screen.getByTestId('look-place-source').textContent).toBe('Pinned');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });

  it('Follows hands the pin back, and Reset clears it', () => {
    seed('outdoor');
    render(<PlaceSection {...with_(roomT)} />);
    fireEvent.click(screen.getByRole('button', { name: /Indoor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Follows/ }));
    expect(ownLook(st(), roomT)?.place).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /Indoor/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(ownLook(st(), roomT)?.place).toBeUndefined();
    expect(pressed(/Follows/)).toBe('true');
  });

  it('writes a level pin the same way, and it is one undo step', () => {
    seed('outdoor');
    render(<PlaceSection {...with_(levelT())} />);
    fireEvent.click(screen.getByRole('button', { name: /Indoor/ }));
    expect(ownLook(st(), levelT())?.place).toBe('indoor');
    undoManager.undo();
    expect(ownLook(st(), levelT())?.place).toBeUndefined();
  });

  it('says the map is shown unlit on the room and level cards, and not once a time is picked', () => {
    localStorage.clear();
    resetViewPrefsForTests();
    seed('outdoor');
    for (const target of [roomT, levelT()]) {
      render(<PlaceSection {...with_(target)} />);
      expect(screen.getByText(/Shown unlit/)).toBeTruthy();
      cleanup();
    }
    setPreview('day');
    for (const target of [roomT, levelT()]) {
      render(<PlaceSection {...with_(target)} />);
      expect(screen.queryByText(/Shown unlit/)).toBeNull();
      cleanup();
    }
    localStorage.clear();
    resetViewPrefsForTests();
  });

  it('is on the room card and the level card, and on no mood field', () => {
    for (const kind of ['room', 'level'] as const) {
      const ids = cards.find((c) => c.kind === kind)!.fields.map((f) => f.id);
      expect(ids).toContain(`card.${kind}.place`);
      expect(ids.some((id) => /mood/i.test(id))).toBe(false);
    }
  });
});

