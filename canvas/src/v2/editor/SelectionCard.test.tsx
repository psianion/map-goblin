import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer, ShapeChild, WaterChild } from '@/store/types';
import type { DoorChild, WallSegment } from '@/shared/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <span data-testid="thumb">{textureId}</span>,
}));

const square = (x: number): [number, number][][] => [[[x, 0], [x + 2, 0], [x + 2, 2], [x, 2]]];

function shape(id: string, over: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: square(0),
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...over,
  };
}

function water(id: string, over: Partial<WaterChild> = {}): WaterChild {
  return {
    id,
    name: id,
    childType: 'water',
    visible: true,
    waterType: 'river',
    contours: square(4),
    textureId: 'w',
    tint: '#336699',
    opacity: 0.8,
    bankTextureId: '',
    bankWidth: 0.5,
    ...over,
  };
}


function seed(children: AnyChild[], selected: string[], rooms: DungeonLayer['rooms'] = []) {
  const layer = {
    id: 'l1',
    type: 'dungeon',
    name: 'Dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children,
    rooms,
    standaloneWalls: [],
    mergedFloor: null,
    style: { floorColor: '#aabbcc' },
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
  useStore.setState((s) => {
    s.selection.selectedIds = selected;
  });
}

const child = (id: string) =>
  (useStore.getState().layers[0] as DungeonLayer).children.find((c) => c.id === id) as AnyChild;

/** Undo once and report whether anything older is left: exactly one entry means false. */
function undoOnce(): boolean {
  act(() => undoManager.undo());
  return undoManager.canUndo();
}

describe('SelectionCard', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
    sessionStorage.clear();
  });

  describe('floors', () => {
    it('shows texture and tint for textured floors, and keeps the fill rows folded until asked', () => {
      seed([shape('a', { textureId: 'p:stone' })], ['a']);
      const onOpenAssets = vi.fn();
      render(<SelectionCard onOpenAssets={onOpenAssets} />);
      // The floor colour paints nothing under a texture, so its row is gone.
      expect(screen.queryByText('Colour')).toBeNull();
      expect(screen.getByText('Texture')).not.toBeNull();
      expect(screen.getByTestId('thumb').textContent).toBe('p:stone');
      expect(screen.getByText('Tint')).not.toBeNull();
      expect(screen.queryByText('Reset')).toBeNull();
      expect(screen.queryByLabelText('Scale')).toBeNull();

      fireEvent.click(screen.getByText('Change'));
      expect(onOpenAssets).toHaveBeenCalledWith('floor');

      fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
      expect(screen.getByLabelText('Scale')).not.toBeNull();
      expect(screen.getByLabelText('Rotate')).not.toBeNull();
      expect(screen.getByLabelText('Offset X')).not.toBeNull();
      expect(sessionStorage.getItem('v2-sel-fill-open')).toBe('1');
    });

    it('shows colour and no tint or fill for untextured floors', () => {
      sessionStorage.setItem('v2-sel-fill-open', '1');
      seed([shape('a')], ['a']);
      render(<SelectionCard />);
      expect(screen.getByText('Colour')).not.toBeNull();
      expect(screen.getByText('#AABBCC')).not.toBeNull();
      expect(screen.queryByText('Tint')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull();
      expect(screen.queryByLabelText('Scale')).toBeNull();
    });

    it('shows both colour and tint for a mix of textured and untextured floors', () => {
      seed([shape('a', { textureId: 'p:stone' }), shape('b')], ['a', 'b']);
      render(<SelectionCard />);
      expect(screen.getByText('Colour')).not.toBeNull();
      expect(screen.getByText('Tint')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Fill' })).not.toBeNull();
    });

    it('says None with no texture and drops Change when the shell gives no browser', () => {
      seed([shape('a')], ['a']);
      render(<SelectionCard />);
      expect(screen.getAllByText('None').length).toBeGreaterThan(0);
      expect(screen.queryByText('Change')).toBeNull();
    });

    it('shows Mixed for a colour the selection disagrees on', () => {
      seed([shape('a', { styleOverrides: { floorColor: '#112233' } }), shape('b')], ['a', 'b']);
      render(<SelectionCard />);
      expect(screen.getByText('2 floors')).not.toBeNull();
      expect(screen.getByText('Mixed')).not.toBeNull();
    });

    it('Reset clears overrides on two shapes in one undo step', () => {
      seed(
        [
          shape('a', { styleOverrides: { floorColor: '#112233' } }),
          shape('b', { styleOverrides: { floorColor: '#445566' } }),
        ],
        ['a', 'b'],
      );
      render(<SelectionCard />);
      fireEvent.click(screen.getByText('Reset'));
      expect(child('a').styleOverrides).toBeUndefined();
      expect(child('b').styleOverrides).toBeUndefined();
      expect(screen.queryByText('Reset')).toBeNull();

      expect(undoOnce()).toBe(false);
      expect(child('a').styleOverrides).toEqual({ floorColor: '#112233' });
      expect(child('b').styleOverrides).toEqual({ floorColor: '#445566' });
    });

    it('Fill has no Reset while every shape sits on the default fill', () => {
      seed([shape('a', { textureId: 'p:stone' }), shape('b', { textureId: 'p:stone' })], ['a', 'b']);
      render(<SelectionCard />);
      expect(screen.getByRole('button', { name: 'Fill' })).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Reset fill' })).toBeNull();
    });

    it('Fill Reset puts scale, rotate, offset and tint back on every shape in one undo step', () => {
      seed(
        [
          shape('a', { textureId: 'p:stone', textureScale: 2, textureFillRotation: Math.PI / 2 }),
          shape('b', { textureId: 'p:stone', textureOffsetX: 0.5, textureOffsetY: -1, textureTint: '#884422' }),
          shape('c', { textureId: 'p:stone' }),
        ],
        ['a', 'b', 'c'],
      );
      render(<SelectionCard />);
      fireEvent.click(screen.getByRole('button', { name: 'Reset fill' }));
      for (const id of ['a', 'b']) {
        expect(child(id)).toMatchObject({
          textureScale: 1,
          textureOffsetX: 0,
          textureOffsetY: 0,
          textureFillRotation: 0,
          textureTint: '#ffffff',
        });
      }
      expect(screen.queryByRole('button', { name: 'Reset fill' })).toBeNull();

      expect(undoOnce()).toBe(false);
      expect(child('a')).toMatchObject({ textureScale: 2, textureFillRotation: Math.PI / 2 });
      expect(child('b')).toMatchObject({ textureOffsetX: 0.5, textureOffsetY: -1, textureTint: '#884422' });
    });

    it('a colour typed into the picker lands as one undo step for both shapes', () => {
      seed([shape('a'), shape('b')], ['a', 'b']);
      render(<SelectionCard />);
      fireEvent.click(screen.getByRole('button', { name: /Colour colour/ }));
      const hex = screen.getByLabelText('Hex colour');
      fireEvent.change(hex, { target: { value: '#010203' } });
      fireEvent.keyDown(hex, { key: 'Enter' });
      expect(child('a').styleOverrides).toEqual({ floorColor: '#010203' });
      expect(undoManager.canUndo()).toBe(false); // live, not yet committed
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(undoManager.canUndo()).toBe(true);

      expect(undoOnce()).toBe(false);
      expect(child('a').styleOverrides).toBeUndefined();
      expect(child('b').styleOverrides).toBeUndefined();
    });

    it('a tint typed on a textured floor patches live and lands as one undo step', () => {
      seed([shape('a', { textureId: 'p:stone' })], ['a']);
      render(<SelectionCard />);
      fireEvent.click(screen.getByRole('button', { name: /Tint colour/ }));
      const hex = screen.getByLabelText('Hex colour');
      fireEvent.change(hex, { target: { value: '#4080ff' } });
      fireEvent.keyDown(hex, { key: 'Enter' });
      expect((child('a') as ShapeChild).textureTint).toBe('#4080ff');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByText('#4080FF')).not.toBeNull();

      expect(undoOnce()).toBe(false);
      expect((child('a') as ShapeChild).textureTint).toBe('#ffffff');
    });

    it('a textured floor with a pinned colour keeps a Reset that clears it in one step', () => {
      seed([shape('a', { textureId: 'p:stone', styleOverrides: { floorColor: '#ff0000' } })], ['a']);
      render(<SelectionCard />);
      // No Colour picker: the colour paints nothing under the texture.
      expect(screen.queryByRole('button', { name: /Colour colour/ })).toBeNull();
      expect(screen.getByTestId('v2-sel-floor-pinned').textContent).toContain('Own, under texture');
      fireEvent.click(screen.getByText('Reset'));
      expect(child('a').styleOverrides).toBeUndefined();
      expect(screen.queryByTestId('v2-sel-floor-pinned')).toBeNull();

      expect(undoOnce()).toBe(false);
      expect(child('a').styleOverrides).toEqual({ floorColor: '#ff0000' });
    });

    it('on a mixed selection Colour pins only the plain floor and Tint only the textured one', () => {
      seed([shape('hall', { textureId: 'p:stone' }), shape('court')], ['hall', 'court']);
      render(<SelectionCard />);
      fireEvent.click(screen.getByRole('button', { name: /Colour colour/ }));
      let hex = screen.getByLabelText('Hex colour');
      fireEvent.change(hex, { target: { value: '#20a040' } });
      fireEvent.keyDown(hex, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(child('court').styleOverrides).toEqual({ floorColor: '#20a040' });
      expect(child('hall').styleOverrides).toBeUndefined();

      fireEvent.click(screen.getByRole('button', { name: /Tint colour/ }));
      hex = screen.getByLabelText('Hex colour');
      fireEvent.change(hex, { target: { value: '#4080ff' } });
      fireEvent.keyDown(hex, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect((child('hall') as ShapeChild).textureTint).toBe('#4080ff');
      expect((child('court') as ShapeChild).textureTint).toBe('#ffffff');
    });

    it('a scale drag patches live and commits once on release', () => {
      sessionStorage.setItem('v2-sel-fill-open', '1');
      seed([shape('a', { textureId: 'p:stone' }), shape('b', { textureId: 'p:stone', textureScale: 2 })], ['a', 'b']);
      render(<SelectionCard />);
      const scale = screen.getByLabelText('Scale');
      expect(screen.getAllByText('Mixed').length).toBeGreaterThan(0);
      fireEvent.pointerDown(scale);
      fireEvent.change(scale, { target: { value: '1.5' } });
      expect((child('b') as ShapeChild).textureScale).toBe(1.5);
      fireEvent.pointerUp(scale);

      expect(undoOnce()).toBe(false);
      expect((child('a') as ShapeChild).textureScale).toBe(1);
      expect((child('b') as ShapeChild).textureScale).toBe(2);
    });

    it('rotation shows degrees and stores radians', () => {
      sessionStorage.setItem('v2-sel-fill-open', '1');
      seed([shape('a', { textureId: 'p:stone', textureFillRotation: Math.PI / 2 })], ['a']);
      render(<SelectionCard />);
      const rotate = screen.getByLabelText('Rotate') as HTMLInputElement;
      expect(rotate.value).toBe('90');
      fireEvent.pointerDown(rotate);
      fireEvent.change(rotate, { target: { value: '180' } });
      fireEvent.pointerUp(rotate);
      expect((child('a') as ShapeChild).textureFillRotation).toBeCloseTo(Math.PI);
    });
  });

  describe('water', () => {
    it('a lake shows Banks, Tint and Opacity, and no Flow', () => {
      seed([water('w', { waterType: 'lake' })], ['w']);
      render(<SelectionCard />);
      expect(screen.getByRole('switch', { name: 'Banks' })).not.toBeNull();
      expect(screen.getByText('Tint')).not.toBeNull();
      expect(screen.getByLabelText('Opacity')).not.toBeNull();
      expect(screen.queryByLabelText('Flow')).toBeNull();
      expect(screen.queryByText('Lakes do not flow.')).toBeNull();
    });

    it('a river has no Flow either, and banks toggle in one step', () => {
      seed([water('w', { flowSpeed: 0.3, flowAngle: 0 })], ['w']);
      render(<SelectionCard />);
      expect(screen.queryByLabelText('Flow')).toBeNull();
      fireEvent.click(screen.getByRole('switch', { name: 'Banks' }));
      expect((child('w') as WaterChild).bankTextureId).toBe('gg-forge:bank-grassy-01-a1');
      expect(undoOnce()).toBe(false);
      expect((child('w') as WaterChild).bankTextureId).toBe('');
    });
  });

  describe('doors', () => {
    const door = (over: Partial<DoorChild> = {}): DoorChild => ({
      id: 'd1',
      name: 'Door 1',
      childType: 'door',
      visible: true,
      wallId: 'w1',
      position: [2.5, 0],
      angle: 0,
      width: 1,
      style: 'single',
      state: 'closed',
      isSecret: false,
      ...over,
    });
    const wall: WallSegment = {
      id: 'w1',
      points: [
        [0, 0],
        [5, 0],
      ],
      wallType: 'normal',
      direction: 'both',
      color: '#000000',
      roughness: 0,
    };
    function seedDoor(d: DoorChild) {
      seed([d], [d.id]);
      useStore.setState((s) => {
        (s.layers[0] as DungeonLayer).standaloneWalls = [structuredClone(wall)];
      });
    }
    const d1 = () => child('d1') as DoorChild;

    it('shows name, style, state, secret and width in the card itself', () => {
      seedDoor(door());
      render(<SelectionCard />);
      expect(screen.getByTestId('v2-sel-door')).not.toBeNull();
      expect((screen.getByLabelText('Door name') as HTMLInputElement).value).toBe('Door 1');
      expect((screen.getByRole('combobox', { name: 'Style' }) as HTMLSelectElement).value).toBe('single');
      const styles = [...screen.getByRole('combobox', { name: 'Style' }).querySelectorAll('option')].map((o) => o.textContent);
      expect(styles).toEqual(['Single', 'Double', 'Portcullis', 'Archway', 'Portal']);
      expect(screen.getByRole('button', { name: 'Closed' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('switch', { name: 'Secret' }).getAttribute('aria-checked')).toBe('false');
      const width = screen.getByRole('slider', { name: 'Width' }) as HTMLInputElement;
      expect(width.min).toBe('1');
      expect(width.max).toBe('4');
      expect(width.step).toBe('0.25');
      // The v1 panel is gone from the card.
      expect(screen.queryByText('Door Properties')).toBeNull();
    });

    it('a style change takes the width with it, and one undo puts both back', () => {
      seedDoor(door());
      render(<SelectionCard />);
      fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'double' } });
      expect(d1().style).toBe('double');
      expect(d1().width).toBe(2);
      expect(undoOnce()).toBe(false);
      expect(d1().style).toBe('single');
      expect(d1().width).toBe(1);
    });

    it('state, secret and Portal each land as one undo step', () => {
      seedDoor(door());
      render(<SelectionCard />);
      fireEvent.click(screen.getByRole('button', { name: 'Locked' }));
      expect(d1().state).toBe('locked');
      expect(undoOnce()).toBe(false);
      expect(d1().state).toBe('closed');

      fireEvent.click(screen.getByRole('switch', { name: 'Secret' }));
      expect(d1().isSecret).toBe(true);
      expect(undoOnce()).toBe(false);
      expect(d1().isSecret).toBe(false);

      fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'portal' } });
      expect(d1().style).toBe('portal');
    });

    it('an archway shows no state', () => {
      seedDoor(door({ style: 'archway', width: 2, state: 'open' }));
      render(<SelectionCard />);
      expect(screen.queryByRole('group', { name: 'State' })).toBeNull();
    });

    it('a width drag patches live, stays on the wall and commits once', () => {
      seedDoor(door());
      render(<SelectionCard />);
      const width = screen.getByRole('slider', { name: 'Width' });
      fireEvent.pointerDown(width);
      fireEvent.change(width, { target: { value: '2.5' } });
      expect(d1().width).toBe(2.5);
      fireEvent.change(width, { target: { value: '3' } });
      fireEvent.pointerUp(width);
      expect(d1().width).toBe(3);
      expect(undoOnce()).toBe(false);
      expect(d1().width).toBe(1);
    });

    describe('Angle', () => {
      const w1 = () => (useStore.getState().layers[0] as DungeonLayer).standaloneWalls.find((w) => w.id === 'w1')!;
      function seedFree() {
        seed([door({ position: [2.5, 0] })], ['d1']);
        useStore.setState((s) => {
          (s.layers[0] as DungeonLayer).standaloneWalls = [{ ...structuredClone(wall), points: [[2, 0], [3, 0]] }];
        });
      }

      it('a door on a long wall reads its wall’s angle and says to turn the wall', () => {
        seedDoor(door());
        render(<SelectionCard />);
        const row = screen.getByTestId('v2-door-angle');
        expect(row.textContent).toContain('0°');
        expect(row.textContent).toContain('Turn the wall to turn this door');
        expect(screen.queryByRole('spinbutton', { name: 'Door angle' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Turn 90°' })).toBeNull();
      });

      it('Turn 90° on a free-standing door turns its piece about the door and writes both, one undo step', () => {
        seedFree();
        render(<SelectionCard />);
        expect((screen.getByRole('spinbutton', { name: 'Door angle' }) as HTMLInputElement).value).toBe('0');
        fireEvent.click(screen.getByRole('button', { name: 'Turn 90°' }));
        const [a, b] = w1().points;
        expect(a[0]).toBeCloseTo(2.5);
        expect(b[0]).toBeCloseTo(2.5);
        expect(Math.abs(b[1] - a[1])).toBeCloseTo(1);
        expect(d1().angle).toBeCloseTo(Math.PI / 2);
        expect((screen.getByRole('spinbutton', { name: 'Door angle' }) as HTMLInputElement).value).toBe('90');
        expect(undoOnce()).toBe(false);
        expect(w1().points).toEqual([[2, 0], [3, 0]]);
        expect(d1().angle).toBe(0);
      });

      it('a typed angle turns the piece live and lands as one step on Enter', () => {
        seedFree();
        render(<SelectionCard />);
        const field = screen.getByRole('spinbutton', { name: 'Door angle' }) as HTMLInputElement;
        expect(field.step).toBe('15');
        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: '45' } });
        expect(d1().angle).toBeCloseTo(Math.PI / 4);
        expect(w1().points[1][1]).toBeGreaterThan(0);
        fireEvent.keyDown(field, { key: 'Enter' });
        fireEvent.blur(field);
        expect(d1().angle).toBeCloseTo(Math.PI / 4);
        expect(undoOnce()).toBe(false);
        expect(w1().points).toEqual([[2, 0], [3, 0]]);
      });
    });

    describe('on a doorway piece between longer walls (fieldstone-keep)', () => {
      const piece = (id: string, a: number, b: number): WallSegment => ({ ...wall, id, points: [[a, 0], [b, 0]] });
      function seedRun(d: DoorChild, setId?: string) {
        seed([d], [d.id]);
        useStore.setState((s) => {
          const l = s.layers[0] as DungeonLayer;
          l.standaloneWalls = [piece('left', 0, 8), piece('w1', 8, 10), piece('right', 10, 16)];
          if (setId) l.style = { ...l.style, wallTextureSetId: setId } as DungeonLayer['style'];
        });
      }
      const dbl = () => door({ position: [9, 0], width: 2, style: 'double' });
      const wallPts = (id: string) =>
        (useStore.getState().layers[0] as DungeonLayer).standaloneWalls.find((w) => w.id === id)!.points;

      it('a double has the whole Width range, and a drag is one undo step', () => {
        seedRun(dbl(), 'GG_Cave_Ink');
        render(<SelectionCard />);
        const width = screen.getByRole('slider', { name: 'Width' }) as HTMLInputElement;
        expect(width.min).toBe('2');
        expect(width.max).toBe('4');
        fireEvent.pointerDown(width);
        fireEvent.change(width, { target: { value: '2.5' } });
        fireEvent.change(width, { target: { value: '3.5' } });
        fireEvent.pointerUp(width);
        expect(d1().width).toBe(3.5);
        // The walls either side meet the door's edges.
        expect(wallPts('left')).toEqual([[0, 0], [7.25, 0]]);
        expect(wallPts('w1')).toEqual([[7.25, 0], [10.75, 0]]);
        expect(wallPts('right')).toEqual([[10.75, 0], [16, 0]]);
        expect(undoOnce()).toBe(false);
        expect(d1().width).toBe(2);
        expect(wallPts('left')).toEqual([[0, 0], [8, 0]]);
        expect(wallPts('right')).toEqual([[10, 0], [16, 0]]);
      });

      it('a narrower door brings the walls in to its jambs, live and in one step', () => {
        seedRun(door({ position: [9, 0], width: 2 }), 'GG_Cave_Ink');
        render(<SelectionCard />);
        const width = screen.getByRole('slider', { name: 'Width' });
        fireEvent.pointerDown(width);
        fireEvent.change(width, { target: { value: '1.5' } });
        expect(wallPts('left')).toEqual([[0, 0], [8.25, 0]]);
        fireEvent.change(width, { target: { value: '1' } });
        fireEvent.pointerUp(width);
        expect(wallPts('left')).toEqual([[0, 0], [8.5, 0]]);
        expect(wallPts('right')).toEqual([[9.5, 0], [16, 0]]);
        expect(undoOnce()).toBe(false);
        expect(wallPts('left')).toEqual([[0, 0], [8, 0]]);
      });

      it('W is the door’s width, typed: live, held to the range, one step on Enter; no H', () => {
        seedRun(door({ position: [9, 0], width: 2 }));
        render(<SelectionCard />);
        expect(screen.queryByText('H')).toBeNull();
        const w = screen.getByRole('spinbutton', { name: 'Door width' }) as HTMLInputElement;
        expect(w.value).toBe('2');
        w.focus();
        fireEvent.focus(w);
        fireEvent.change(w, { target: { value: '3.25' } });
        expect(d1().width).toBe(3.25);
        fireEvent.change(w, { target: { value: '9' } });
        expect(d1().width).toBe(4);
        fireEvent.keyDown(w, { key: 'Enter' });
        fireEvent.blur(w);
        expect(d1().width).toBe(4);
        expect(undoOnce()).toBe(false);
        expect(d1().width).toBe(2);
      });

      it('Esc in W puts the width back with nothing to undo', () => {
        seedRun(door({ position: [9, 0], width: 2 }));
        render(<SelectionCard />);
        const w = screen.getByRole('spinbutton', { name: 'Door width' }) as HTMLInputElement;
        fireEvent.focus(w);
        fireEvent.change(w, { target: { value: '3' } });
        fireEvent.keyDown(w, { key: 'Escape' });
        fireEvent.blur(w);
        expect(d1().width).toBe(2);
        expect(undoManager.canUndo()).toBe(false);
      });

      it('a style change keeps a width the run has room for, and double from single grows to two', () => {
        seedRun(door({ position: [9, 0], width: 1 }), 'GG_Cave_Ink');
        render(<SelectionCard />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'double' } });
        expect(d1().width).toBe(2);
        fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'portcullis' } });
        expect(d1().width).toBe(2);
        expect(d1().style).toBe('portcullis');
      });
    });

    it('renames on Enter, and Esc or an empty name keeps the old one', () => {
      seedDoor(door());
      render(<SelectionCard />);
      const input = screen.getByLabelText('Door name') as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: 'Crypt door' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(d1().name).toBe('Crypt door');
      expect(undoOnce()).toBe(false);
      expect(d1().name).toBe('Door 1');

      input.focus();
      fireEvent.change(input, { target: { value: 'Nope' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input.value).toBe('Door 1');
      input.focus();
      fireEvent.change(input, { target: { value: '  ' } });
      fireEvent.blur(input);
      expect(d1().name).toBe('Door 1');
      expect(undoManager.canUndo()).toBe(false);
    });

    describe('kit doors', () => {
      /** A door in a wall of `setId`, pinned on the wall or set on the layer. */
      function seedKitDoor(d: DoorChild, setId: string | undefined, on: 'layer' | 'wall' = 'layer') {
        seedDoor(d);
        useStore.setState((s) => {
          const l = s.layers[0] as DungeonLayer;
          if (on === 'layer') l.style = { ...l.style, wallTextureSetId: setId } as DungeonLayer['style'];
          else l.standaloneWalls[0].textureSetId = setId ?? '';
        });
      }
      const kitRows = () => ({
        opensTo: screen.queryByRole('slider', { name: 'Opens to' }),
        hinge: screen.queryByRole('group', { name: 'Hinge' }),
        swing: screen.queryByRole('group', { name: 'Swing' }),
        hinges: screen.queryByRole('switch', { name: 'Hinges' }),
      });

      it('a closed single door in a kit wall shows the angle it will open to, hinge, swing and hinges', () => {
        seedKitDoor(door(), 'GG_Fieldstone');
        render(<SelectionCard />);
        const rows = kitRows();
        expect((rows.opensTo as HTMLInputElement).value).toBe('90');
        expect(screen.getByText('90° when open')).not.toBeNull();
        expect(rows.hinge).not.toBeNull();
        expect(rows.swing).not.toBeNull();
        expect(rows.hinges?.getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('button', { name: 'Start' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe('true');
      });

      it('opening the door brings the angle in, at 90° until set', () => {
        seedKitDoor(door(), 'GG_Cave_Ink');
        render(<SelectionCard />);
        fireEvent.click(screen.getByRole('button', { name: 'Open' }));
        const angle = screen.getByRole('slider', { name: 'Opens to' }) as HTMLInputElement;
        expect(angle.value).toBe('90');
        expect(angle.min).toBe('0');
        expect(angle.max).toBe('180');
        expect(angle.step).toBe('5');
        expect(screen.getByText('90°')).not.toBeNull();
      });

      it('an opening drag patches live and commits once; undo leaves it unset', () => {
        seedKitDoor(door({ state: 'open' }), 'GG_Palisade');
        render(<SelectionCard />);
        const angle = screen.getByRole('slider', { name: 'Opens to' });
        fireEvent.pointerDown(angle);
        fireEvent.change(angle, { target: { value: '135' } });
        expect(d1().openAngle).toBe(135);
        fireEvent.change(angle, { target: { value: '180' } });
        fireEvent.pointerUp(angle);
        expect(d1().openAngle).toBe(180);
        expect(undoOnce()).toBe(false);
        expect(d1().openAngle).toBeUndefined();
      });

      it('hinge, swing and hinges each land as one undo step', () => {
        seedKitDoor(door(), 'GG_Fieldstone');
        render(<SelectionCard />);
        fireEvent.click(screen.getByRole('button', { name: 'End' }));
        expect(d1().hinge).toBe('end');
        expect(undoOnce()).toBe(false);
        expect(d1().hinge).toBeUndefined();

        fireEvent.click(screen.getByRole('button', { name: 'Reversed' }));
        expect(d1().swing).toBe(-1);
        expect(undoOnce()).toBe(false);
        expect(d1().swing).toBeUndefined();

        fireEvent.click(screen.getByRole('switch', { name: 'Hinges' }));
        expect(d1().hinges).toBe(false);
        expect(undoOnce()).toBe(false);
        expect(d1().hinges).toBeUndefined();

        // Picking what is already showing writes nothing.
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
        expect(undoManager.canUndo()).toBe(false);
      });

      it('a double door hangs on both edges, so it has no hinge choice', () => {
        seedKitDoor(door({ style: 'double', width: 2 }), 'GG_Fieldstone');
        render(<SelectionCard />);
        const rows = kitRows();
        expect(rows.hinge).toBeNull();
        expect(rows.swing).not.toBeNull();
        expect(rows.hinges).not.toBeNull();
      });

      it('no kit rows for a style a kit does not build, or a wall set without a kit', () => {
        seedKitDoor(door({ style: 'portcullis', state: 'open' }), 'GG_Fieldstone');
        const { unmount } = render(<SelectionCard />);
        expect(Object.values(kitRows()).every((r) => r === null)).toBe(true);
        unmount();

        seedKitDoor(door({ state: 'open' }), undefined);
        render(<SelectionCard />);
        expect(Object.values(kitRows()).every((r) => r === null)).toBe(true);
      });

      it('follows the set the wall resolves to: a wall pinned off the kit drops the rows', () => {
        seedKitDoor(door(), 'GG_Fieldstone');
        useStore.setState((s) => {
          (s.layers[0] as DungeonLayer).standaloneWalls[0].textureSetId = 'GG_Plain_Brick';
        });
        const { unmount } = render(<SelectionCard />);
        expect(kitRows().swing).toBeNull();
        unmount();

        // And the other way: a layer with no set, its wall pinned to a kit set.
        seedKitDoor(door(), 'GG_Cave_Ink', 'wall');
        render(<SelectionCard />);
        expect(kitRows().swing).not.toBeNull();
      });

      it('setting Opens to on a shut door is one step and does not open it', () => {
        seedKitDoor(door({ state: 'locked' }), 'GG_Cave_Ink');
        render(<SelectionCard />);
        const angle = screen.getByRole('slider', { name: 'Opens to' });
        fireEvent.keyDown(angle, { key: 'ArrowRight' });
        fireEvent.change(angle, { target: { value: '120' } });
        fireEvent.keyUp(angle, { key: 'ArrowRight' });
        expect(d1().openAngle).toBe(120);
        expect(d1().state).toBe('locked');
        expect(screen.getByText('120° when open')).not.toBeNull();
        expect(undoOnce()).toBe(false);
      });

      it('Material picks the kit: Auto names the wall’s, a pick shows on any wall, one undo step each', () => {
        seedKitDoor(door(), undefined);
        render(<SelectionCard />);
        const material = () => screen.getByRole('combobox', { name: 'Material' }) as HTMLSelectElement;
        expect(material().value).toBe('auto');
        expect([...material().querySelectorAll('option')].map((o) => o.textContent)).toEqual([
          'Auto (plain)',
          'Stone',
          'Wood',
          'Cave',
        ]);
        expect(kitRows().swing).toBeNull();

        fireEvent.change(material(), { target: { value: 'cave' } });
        expect(d1().kit).toBe('cave');
        expect(material().value).toBe('cave');
        // Built from a kit now, so it hangs.
        expect(kitRows().swing).not.toBeNull();
        expect(kitRows().opensTo).not.toBeNull();
        expect(undoOnce()).toBe(false);
        expect(d1().kit).toBeUndefined();

        fireEvent.change(material(), { target: { value: 'wood' } });
        fireEvent.change(material(), { target: { value: 'auto' } });
        expect(d1().kit).toBeUndefined();
        act(() => undoManager.undo());
        expect(d1().kit).toBe('wood');
      });

      it('Material on a Cave Ink wall reads Auto (Cave), and a style without a kit has none', () => {
        seedKitDoor(door({ style: 'double', width: 2 }), 'GG_Cave_Ink');
        const { unmount } = render(<SelectionCard />);
        expect(screen.getByRole('option', { name: 'Auto (Cave)' })).not.toBeNull();
        fireEvent.change(screen.getByRole('combobox', { name: 'Material' }), { target: { value: 'stone' } });
        expect(d1().kit).toBe('stone');
        unmount();

        seedKitDoor(door({ style: 'portcullis' }), 'GG_Cave_Ink');
        render(<SelectionCard />);
        expect(screen.queryByRole('combobox', { name: 'Material' })).toBeNull();
      });

      it('a door on a floor edge takes the set its floor pins, not the layer set', () => {
        const ring: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4]];
        const floor = shape('f1', { contours: [ring], styleOverrides: { wallTextureSetId: 'GG_Cave_Ink' } });
        const onEdge = door({ wallId: '', position: [3, 0] });
        const seedRing = (pinned: boolean) => {
          seed([pinned ? floor : { ...floor, styleOverrides: undefined }, onEdge], ['d1']);
          useStore.setState((s) => {
            const l = s.layers[0] as DungeonLayer;
            l.mergedFloor = [ring];
            l.style = { ...l.style, wallTextureSetId: undefined } as DungeonLayer['style'];
          });
        };
        seedRing(true);
        const { unmount } = render(<SelectionCard />);
        expect(kitRows().swing).not.toBeNull();
        unmount();

        seedRing(false);
        render(<SelectionCard />);
        expect(kitRows().swing).toBeNull();
      });
    });
  });

  it('a mix of kinds keeps the header and shows no shared fields', () => {
    seed([shape('a'), water('w')], ['a', 'w']);
    render(<SelectionCard />);
    expect(screen.getByText('1 floor · 1 water body')).not.toBeNull();
    expect(screen.queryByText('Colour')).toBeNull();
    expect(screen.queryByText('Flow')).toBeNull();
  });
});

describe('SelectionCard: drawn walls', () => {
  const wall = (id: string, over: Partial<WallSegment> = {}): WallSegment => ({
    id,
    points: [
      [0, 0],
      [4, 0],
      [4, 3],
    ],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    roughness: 0,
    ...over,
  });

  function seedWalls(walls: WallSegment[], selected: string[], children: AnyChild[] = []) {
    seed(children, selected);
    useStore.setState((s) => {
      const l = s.layers[0] as DungeonLayer;
      l.standaloneWalls = walls.map((w) => structuredClone(w));
      l.style = { ...l.style, wallTextureSetId: 'GG_Fieldstone' };
    });
  }
  const liveWall = (id: string) =>
    (useStore.getState().layers[0] as DungeonLayer).standaloneWalls.find((w) => w.id === id) as WallSegment;

  beforeEach(() => {
    cleanup();
    undoManager.clear();
  });

  it('a selected wall gets the card: title, its type and the set it resolves to', () => {
    seedWalls([wall('w1')], ['w1']);
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-selection-card').querySelector('.v2-sel__name')?.textContent).toBe('Wall');
    expect(screen.getByTestId('v2-sel-wall')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Solid' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Fieldstone')).not.toBeNull();
    // A wall measures as its length along the line (4 + 3), the number its box shows too.
    expect(screen.getByTestId('v2-sel-wall-length').textContent).toBe('7.0 sq');
  });

  it('a wall’s card has one Length, no W and H', () => {
    seedWalls([wall('w1', { points: [[0, 0], [3.5, 0]] })], ['w1']);
    render(<SelectionCard />);
    expect(screen.getByText('Length')).not.toBeNull();
    expect(screen.getByTestId('v2-sel-wall-length').textContent).toBe('3.5 sq');
    expect(screen.queryByText('W')).toBeNull();
  });

  it('a locked wall’s card says so and its fields are read-only', () => {
    seedWalls([wall('w1', { locked: true })], ['w1']);
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-sel-locked-note').textContent).toBe('Locked: unlock to edit');
    expect((screen.getByTestId('v2-sel-lockset') as HTMLFieldSetElement).disabled).toBe(true);
    // Disabled through the fieldset: a browser sends it no click.
    expect(screen.getByRole('button', { name: 'Window' }).matches(':disabled')).toBe(true);
  });

  it('the set follows the wall’s own pin over the layer’s', () => {
    seedWalls([wall('w1', { textureSetId: 'GG_Cave_Ink' })], ['w1']);
    render(<SelectionCard />);
    expect(screen.getByText('Cave Ink')).not.toBeNull();
  });

  it('Type writes the wall’s type, one undo step', () => {
    seedWalls([wall('w1')], ['w1']);
    render(<SelectionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Window' }));
    expect(liveWall('w1').wallType).toBe('window');
    expect(undoOnce()).toBe(false);
    expect(liveWall('w1').wallType).toBe('normal');
  });

  it('Type on a locked layer is refused and writes nothing', () => {
    seedWalls([wall('w1')], ['w1']);
    useStore.setState((s) => {
      (s.layers[0] as DungeonLayer).locked = true;
    });
    render(<SelectionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(liveWall('w1').wallType).toBe('normal');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('several walls, or a wall with other things, show the count and no fields', () => {
    seedWalls([wall('w1'), wall('w2')], ['w1', 'w2']);
    const { unmount } = render(<SelectionCard />);
    expect(screen.getByText('2 walls')).not.toBeNull();
    expect(screen.queryByTestId('v2-sel-wall')).toBeNull();
    unmount();

    seedWalls([wall('w1')], ['a', 'w1'], [shape('a')]);
    render(<SelectionCard />);
    expect(screen.getByText('1 floor · 1 wall')).not.toBeNull();
    expect(screen.queryByText('Colour')).toBeNull();
    expect(screen.queryByTestId('v2-sel-wall')).toBeNull();
  });

  it('nothing selected that still exists shows no card', () => {
    seedWalls([], ['gone']);
    render(<SelectionCard />);
    expect(screen.queryByTestId('v2-selection-card')).toBeNull();
  });
});

describe('SelectionCard: objects locked on their own', () => {
  beforeEach(() => {
    cleanup();
    undoManager.clear();
  });

  it('a locked water body’s card says so and greys every field', () => {
    seed([water('w', { locked: true })], ['w']);
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-sel-kind').textContent).toBe('Water · locked');
    expect(screen.getByTestId('v2-sel-locked-note').textContent).toBe('Locked: unlock to edit');
    const fields = screen.getByTestId('v2-sel-lockset') as HTMLFieldSetElement;
    expect(fields.disabled).toBe(true);
    expect(fields.querySelectorAll('input, button, select').length).toBeGreaterThan(0);
    // The header's Unlock stays live: it sits outside the greyed fields.
    expect(fields.contains(screen.getByTestId('v2-sel-act-unlock'))).toBe(false);
  });

  it('a locked zone’s position fields are read-only', () => {
    const zone = { id: 'z', name: 'Ambush', childType: 'zone', visible: true, locked: true, shape: { kind: 'circle', position: { x: 4, y: 5 }, radius: 2 } } as unknown as AnyChild;
    seed([zone], ['z']);
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-sel-locked-note')).not.toBeNull();
    expect((screen.getByLabelText('Zone radius') as HTMLInputElement).closest('fieldset')?.disabled).toBe(true);
  });

  it('an unlocked object has no lock line and live fields', () => {
    seed([water('w')], ['w']);
    render(<SelectionCard />);
    expect(screen.queryByTestId('v2-sel-locked-note')).toBeNull();
    expect((screen.getByTestId('v2-sel-lockset') as HTMLFieldSetElement).disabled).toBe(false);
  });
});
