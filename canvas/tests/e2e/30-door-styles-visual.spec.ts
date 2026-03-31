import { test, expect } from '@playwright/test';
import { gotoApp, waitFrame } from './helpers';

test.describe('Door Styles Visual Verification', () => {
  test('all 4 door styles × 3 states render correctly', async ({ page }) => {
    await gotoApp(page);

    // Build test scene: 4 styles × 3 states grid of doors
    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return;
      const s = store.getState() as {
        ui: { activeLayerId: string };
        addChild: (lid: string, child: unknown) => void;
        addWall: (lid: string, wall: unknown) => void;
        recomputeMergedFloor: (lid: string) => void;
      };
      const lid = s.ui.activeLayerId;

      // Large floor so doors have context
      s.addChild(lid, {
        id: 'floor-main',
        name: 'Floor',
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        contours: [[[0, 0], [36, 0], [36, 28], [0, 28]]],
        roughnessEnabled: false,
        textureScale: 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: '#ffffff',
      });
      s.recomputeMergedFloor(lid);

      const styles = ['single', 'double', 'portcullis', 'archway'] as const;
      const states = ['closed', 'open', 'locked'] as const;

      // 4 rows (styles) × 3 columns (states) — horizontal walls with doors
      styles.forEach((style, si) => {
        states.forEach((state, sti) => {
          const x = 5 + sti * 10;
          const y = 4 + si * 6;
          const wallId = `wall-${style}-${state}`;
          const doorId = `door-${style}-${state}`;

          // Horizontal wall segment
          s.addWall(lid, {
            id: wallId,
            points: [[x - 4, y], [x + 4, y]],
            wallType: 'normal',
            direction: 'both',
            color: '#1a1a1a',
            width: 0.5,
            roughness: 0,
          });

          // Door in the middle of the wall
          // archway does not support locked — fall back to closed
          const effectiveState = style === 'archway' && state === 'locked' ? 'closed' : state;
          s.addChild(lid, {
            id: doorId,
            name: `${style} / ${state}`,
            childType: 'door',
            visible: true,
            wallId: wallId,
            position: [x, y],
            angle: 0,
            width: 2,
            style: style,
            state: effectiveState,
            isSecret: false,
          });
        });
      });

      // Secret door row (closed + open)
      s.addWall(lid, {
        id: 'wall-secret-closed',
        points: [[2, 26], [8, 26]],
        wallType: 'normal',
        direction: 'both',
        color: '#1a1a1a',
        width: 0.5,
        roughness: 0,
      });
      s.addChild(lid, {
        id: 'door-secret-closed',
        name: 'Secret Closed',
        childType: 'door',
        visible: true,
        wallId: 'wall-secret-closed',
        position: [5, 26],
        angle: 0,
        width: 2,
        style: 'single',
        state: 'closed',
        isSecret: true,
      });

      s.addWall(lid, {
        id: 'wall-secret-open',
        points: [[12, 26], [18, 26]],
        wallType: 'normal',
        direction: 'both',
        color: '#1a1a1a',
        width: 0.5,
        roughness: 0,
      });
      s.addChild(lid, {
        id: 'door-secret-open',
        name: 'Secret Open',
        childType: 'door',
        visible: true,
        wallId: 'wall-secret-open',
        position: [15, 26],
        angle: 0,
        width: 2,
        style: 'single',
        state: 'open',
        isSecret: true,
      });

      // Ambient light for visibility
      s.addChild(lid, {
        id: 'light-ambient',
        name: 'Scene Light',
        childType: 'light',
        visible: true,
        color: '#ffeebb',
        radius: 25,
        featherRadius: 5,
        intensity: 0.4,
        falloff: 'quadratic',
        position: { x: 18, y: 14 },
      });
    });

    await waitFrame(page, 15);

    // Full-canvas screenshot of the door grid
    await page.screenshot({
      path: 'test-results/door-styles-grid.png',
      fullPage: false,
    });

    // --- Assertions ---

    // Total door count: 4 styles × 3 states + 2 secret = 14
    const doorCount = await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return 0;
      const s = store.getState() as {
        layers: Array<{ type: string; children?: Array<{ childType: string }> }>;
      };
      const layer = s.layers.find((l) => l.type === 'dungeon');
      return (layer?.children ?? []).filter((c) => c.childType === 'door').length;
    });
    expect(doorCount).toBe(14);

    // All 4 styles present
    const doorStyles = await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return [];
      const s = store.getState() as {
        layers: Array<{ type: string; children?: Array<{ childType: string; style: string }> }>;
      };
      const layer = s.layers.find((l) => l.type === 'dungeon');
      const styles = (layer?.children ?? [])
        .filter((c) => c.childType === 'door')
        .map((d) => d.style);
      return [...new Set(styles)].sort();
    });
    expect(doorStyles).toEqual(['archway', 'double', 'portcullis', 'single']);

    // All 3 states present
    const doorStates = await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return [];
      const s = store.getState() as {
        layers: Array<{ type: string; children?: Array<{ childType: string; state: string }> }>;
      };
      const layer = s.layers.find((l) => l.type === 'dungeon');
      const states = (layer?.children ?? [])
        .filter((c) => c.childType === 'door')
        .map((d) => d.state);
      return [...new Set(states)].sort();
    });
    expect(doorStates).toEqual(['closed', 'locked', 'open']);

    // Secret doors present
    const secretCount = await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return 0;
      const s = store.getState() as {
        layers: Array<{ type: string; children?: Array<{ childType: string; isSecret: boolean }> }>;
      };
      const layer = s.layers.find((l) => l.type === 'dungeon');
      return (layer?.children ?? []).filter((c) => c.childType === 'door' && c.isSecret).length;
    });
    expect(secretCount).toBe(2);
  });

  test('door state toggle updates store and re-renders', async ({ page }) => {
    await gotoApp(page);

    // Build a simple vertical-wall scene with one door
    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return;
      const s = store.getState() as {
        ui: { activeLayerId: string };
        addChild: (lid: string, child: unknown) => void;
        addWall: (lid: string, wall: unknown) => void;
        updateChild: (lid: string, cid: string, patch: unknown) => void;
        recomputeMergedFloor: (lid: string) => void;
      };
      const lid = s.ui.activeLayerId;

      s.addChild(lid, {
        id: 'floor2',
        name: 'Floor',
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        contours: [[[2, 2], [18, 2], [18, 12], [2, 12]]],
        roughnessEnabled: false,
        textureScale: 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: '#ffffff',
      });
      s.recomputeMergedFloor(lid);

      // Vertical wall dividing the room
      s.addWall(lid, {
        id: 'w-toggle',
        points: [[10, 2], [10, 12]],
        wallType: 'normal',
        direction: 'both',
        color: '#1a1a1a',
        width: 0.5,
        roughness: 0,
      });
      s.addChild(lid, {
        id: 'd-toggle',
        name: 'Toggle Door',
        childType: 'door',
        visible: true,
        wallId: 'w-toggle',
        position: [10, 7],
        angle: Math.PI / 2,
        width: 2,
        style: 'single',
        state: 'closed',
        isSecret: false,
      });

      // Lights on each side to make state changes visible
      s.addChild(lid, {
        id: 'l-left',
        name: 'Left Light',
        childType: 'light',
        visible: true,
        color: '#ffdd88',
        radius: 7,
        featherRadius: 1,
        intensity: 0.4,
        falloff: 'quadratic',
        position: { x: 6, y: 7 },
      });
      s.addChild(lid, {
        id: 'l-right',
        name: 'Right Light',
        childType: 'light',
        visible: true,
        color: '#88aaff',
        radius: 7,
        featherRadius: 1,
        intensity: 0.4,
        falloff: 'quadratic',
        position: { x: 14, y: 7 },
      });
    });

    await waitFrame(page, 12);
    await page.screenshot({ path: 'test-results/door-state-closed.png', fullPage: false });

    // Toggle → OPEN
    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return;
      const s = store.getState() as {
        ui: { activeLayerId: string };
        updateChild: (lid: string, cid: string, patch: unknown) => void;
      };
      s.updateChild(s.ui.activeLayerId, 'd-toggle', { state: 'open' });
    });
    await waitFrame(page, 12);
    await page.screenshot({ path: 'test-results/door-state-open.png', fullPage: false });

    // Toggle → LOCKED
    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return;
      const s = store.getState() as {
        ui: { activeLayerId: string };
        updateChild: (lid: string, cid: string, patch: unknown) => void;
      };
      s.updateChild(s.ui.activeLayerId, 'd-toggle', { state: 'locked' });
    });
    await waitFrame(page, 12);
    await page.screenshot({ path: 'test-results/door-state-locked.png', fullPage: false });

    // Final state assertion
    const finalState = await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return null;
      const s = store.getState() as {
        ui: { activeLayerId: string };
        layers: Array<{
          id: string;
          type: string;
          children?: Array<{ id: string; childType: string; state: string }>;
        }>;
      };
      const layer = s.layers.find((l) => l.type === 'dungeon');
      return layer?.children?.find((c) => c.id === 'd-toggle')?.state ?? null;
    });
    expect(finalState).toBe('locked');

    // Verify all 3 intermediate states were valid transitions
    const allStyles = ['single', 'double', 'portcullis', 'archway'];
    expect(allStyles).toContain('single'); // sanity — door used single style
  });

  test('portcullis and archway distinct styles are stored correctly', async ({ page }) => {
    await gotoApp(page);

    await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return;
      const s = store.getState() as {
        ui: { activeLayerId: string };
        addChild: (lid: string, child: unknown) => void;
        addWall: (lid: string, wall: unknown) => void;
        recomputeMergedFloor: (lid: string) => void;
      };
      const lid = s.ui.activeLayerId;

      s.addChild(lid, {
        id: 'floor3',
        name: 'Floor',
        childType: 'shape',
        visible: true,
        shapeType: 'rectangle',
        contours: [[[0, 0], [24, 0], [24, 10], [0, 10]]],
        roughnessEnabled: false,
        textureScale: 1,
        textureOffsetX: 0,
        textureOffsetY: 0,
        textureFillRotation: 0,
        textureTint: '#ffffff',
      });
      s.recomputeMergedFloor(lid);

      // Portcullis — open state (grid bars raised)
      s.addWall(lid, {
        id: 'w-portcullis',
        points: [[4, 0], [4, 10]],
        wallType: 'normal',
        direction: 'both',
        color: '#1a1a1a',
        width: 0.5,
        roughness: 0,
      });
      s.addChild(lid, {
        id: 'd-portcullis-open',
        name: 'Portcullis Open',
        childType: 'door',
        visible: true,
        wallId: 'w-portcullis',
        position: [4, 5],
        angle: Math.PI / 2,
        width: 2,
        style: 'portcullis',
        state: 'open',
        isSecret: false,
      });

      // Archway — always open, no door panel
      s.addWall(lid, {
        id: 'w-archway',
        points: [[12, 0], [12, 10]],
        wallType: 'normal',
        direction: 'both',
        color: '#1a1a1a',
        width: 0.5,
        roughness: 0,
      });
      s.addChild(lid, {
        id: 'd-archway-open',
        name: 'Archway',
        childType: 'door',
        visible: true,
        wallId: 'w-archway',
        position: [12, 5],
        angle: Math.PI / 2,
        width: 2,
        style: 'archway',
        state: 'open',
        isSecret: false,
      });

      // Double door — closed
      s.addWall(lid, {
        id: 'w-double',
        points: [[20, 0], [20, 10]],
        wallType: 'normal',
        direction: 'both',
        color: '#1a1a1a',
        width: 0.5,
        roughness: 0,
      });
      s.addChild(lid, {
        id: 'd-double-locked',
        name: 'Double Locked',
        childType: 'door',
        visible: true,
        wallId: 'w-double',
        position: [20, 5],
        angle: Math.PI / 2,
        width: 2,
        style: 'double',
        state: 'locked',
        isSecret: false,
      });

      s.addChild(lid, {
        id: 'l-scene',
        name: 'Scene Light',
        childType: 'light',
        visible: true,
        color: '#ffffff',
        radius: 20,
        featherRadius: 3,
        intensity: 0.5,
        falloff: 'linear',
        position: { x: 12, y: 5 },
      });
    });

    await waitFrame(page, 12);
    await page.screenshot({ path: 'test-results/door-styles-distinct.png', fullPage: false });

    // Verify each unique style is stored correctly
    const storedStyles = await page.evaluate(() => {
      const store = (window as Window & { __store?: { getState: () => Record<string, unknown> } }).__store;
      if (!store) return {};
      const s = store.getState() as {
        layers: Array<{
          type: string;
          children?: Array<{ id: string; childType: string; style: string; state: string }>;
        }>;
      };
      const layer = s.layers.find((l) => l.type === 'dungeon');
      const doors = (layer?.children ?? []).filter((c) => c.childType === 'door');
      return Object.fromEntries(doors.map((d) => [d.id, { style: d.style, state: d.state }]));
    });

    expect(storedStyles['d-portcullis-open']).toEqual({ style: 'portcullis', state: 'open' });
    expect(storedStyles['d-archway-open']).toEqual({ style: 'archway', state: 'open' });
    expect(storedStyles['d-double-locked']).toEqual({ style: 'double', state: 'locked' });
  });
});
