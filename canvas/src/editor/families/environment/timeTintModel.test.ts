import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { setTimeTint, tileTints, timeTintOf, timeTints } from './timeTintModel';

const map = () => useStore.getState().mapSettings;

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
});

describe('a colour for each time of day', () => {
  it('reads every time as the map Colour until it has its own', () => {
    const plain = { ambientLight: '#ddeeff' };
    expect(timeTints(plain).map((t) => [t.label, t.own, t.shown])).toEqual([
      ['Dawn', null, '#ddeeff'],
      ['Day', null, '#ddeeff'],
      ['Dusk', null, '#ddeeff'],
      ['Night', null, '#ddeeff'],
    ]);
    const themed = { ambientLight: '#ddeeff', timeTints: { night: '#3344aa' } };
    expect(timeTintOf(themed, 'night')).toMatchObject({ own: '#3344aa', shown: '#3344aa' });
    expect(timeTintOf(themed, 'day')).toMatchObject({ own: null, shown: '#ddeeff' });
    expect(tileTints(themed)).toEqual({ dawn: '#ddeeff', day: '#ddeeff', dusk: '#ddeeff', night: '#3344aa' });
  });

  it('a pick is one undo step, a drag in the picker folds into it, and a clear is its own step', () => {
    setTimeTint('night', '#110000');
    setTimeTint('night', '#220000');
    setTimeTint('night', '#330000');
    expect(map().timeTints).toEqual({ night: '#330000' });
    undoManager.undo();
    expect(map()).not.toHaveProperty('timeTints');
    undoManager.redo();
    expect(map().timeTints).toEqual({ night: '#330000' });

    setTimeTint('night', null);
    expect(map()).not.toHaveProperty('timeTints');
    undoManager.undo();
    expect(map().timeTints).toEqual({ night: '#330000' });
  });

  it('leaves the map Colour alone, and a time already so is no step', () => {
    const before = map().ambientLight;
    setTimeTint('dusk', '#aa7744');
    expect(map().ambientLight).toBe(before);
    const steps = undoManager.canUndo();
    undoManager.undo();
    setTimeTint('dusk', null);
    expect(steps).toBe(true);
    expect(undoManager.canUndo()).toBe(false);
  });
});
