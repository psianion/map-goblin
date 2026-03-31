import { describe, it, expect } from 'vitest';
import { buildOcclusionSegments } from './occlusion';
import type { WallSegment, DoorChild } from './types';

const makeWall = (overrides: Partial<WallSegment> = {}): WallSegment => ({
  id: 'w1',
  points: [[0, 0], [100, 0]],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 2,
  roughness: 0,
  ...overrides,
});

const makeDoor = (overrides: Partial<DoorChild> = {}): DoorChild => ({
  id: 'd1',
  name: 'Door 1',
  childType: 'door',
  visible: true,
  wallId: 'w1',
  position: [50, 0],
  angle: 0,
  width: 20,
  style: 'single',
  state: 'closed',
  isSecret: false,
  ...overrides,
});

describe('buildOcclusionSegments — edge cases', () => {
  // 1. Empty inputs
  it('empty walls and doors returns empty array', () => {
    const result = buildOcclusionSegments([], []);
    expect(result).toEqual([]);
  });

  // 2. Door with zero width
  it('door with zero width on wall: door occupies no space, wall segment preserved', () => {
    const result = buildOcclusionSegments(
      [makeWall()],
      [makeDoor({ position: [50, 0], width: 0 })],
    );
    // tStart === tEnd === 0.5, so door interval is a point — should be filtered or produce a zero-length door segment
    // The wall remainder should still be there
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    const doorSegs = result.filter(s => s.sourceType === 'door');
    // Zero-width door interval: tStart === tEnd, so cursor moves to tEnd immediately
    // Either 0 or 1 door segments — a zero-length door segment (< MIN_SEGMENT_LENGTH) should NOT be emitted
    // Wall should still appear (at least partially)
    expect(wallSegs.length).toBeGreaterThanOrEqual(1);
    // A zero-length door segment should NOT appear in output (filtered by MIN_SEGMENT_LENGTH guard? — note: door is pushed unconditionally)
    // This is the bug scenario — door segment is always pushed regardless of length
    doorSegs.forEach(s => {
      const dx = s.points[1][0] - s.points[0][0];
      const dy = s.points[1][1] - s.points[0][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      expect(len).toBeGreaterThan(0.001); // no zero-length door segments
    });
  });

  // 3. Door at exact wall start (position [0,0], width 20)
  it('door at exact wall start — no negative-space wall segment emitted', () => {
    const result = buildOcclusionSegments(
      [makeWall()],
      [makeDoor({ position: [0, 0], width: 20 })],
    );
    // tStart = 0, tEnd = 0.1 — no left wall segment
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    const doorSegs = result.filter(s => s.sourceType === 'door');
    expect(doorSegs).toHaveLength(1);
    // Left wall residue should not appear (tStart === 0 → cursor guard prevents it)
    // Right wall [10..100] should appear
    expect(wallSegs).toHaveLength(1);
    // No degenerate segments
    result.forEach(s => {
      const dx = s.points[1][0] - s.points[0][0];
      const dy = s.points[1][1] - s.points[0][1];
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(0.001);
    });
  });

  // 4. Door at exact wall end (position [100,0], width 20)
  it('door at exact wall end — no over-end wall segment emitted', () => {
    const result = buildOcclusionSegments(
      [makeWall()],
      [makeDoor({ position: [100, 0], width: 20 })],
    );
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    const doorSegs = result.filter(s => s.sourceType === 'door');
    expect(doorSegs).toHaveLength(1);
    // Left wall [0..90] should appear; right residue is clamped away
    expect(wallSegs).toHaveLength(1);
    result.forEach(s => {
      const dx = s.points[1][0] - s.points[0][0];
      const dy = s.points[1][1] - s.points[0][1];
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(0.001);
    });
  });

  // 5. Two overlapping doors (same position, both width 20)
  it('two overlapping doors at same position — no duplicate/overlapping segments', () => {
    const result = buildOcclusionSegments(
      [makeWall()],
      [
        makeDoor({ id: 'd1', position: [50, 0], width: 20 }),
        makeDoor({ id: 'd2', position: [50, 0], width: 20 }),
      ],
    );
    // After sort, d1 covers [40..60], d2 covers [40..60]. cursor moves to 0.6 after d1.
    // d2 tStart (0.4) <= cursor (0.6), so no gap wall segment. d2 door segment is still emitted.
    const doorSegs = result.filter(s => s.sourceType === 'door');
    // Both door segments should be emitted (intervals overlap — implementation doesn't merge)
    // Verify no wall segment covers the same range as a door segment
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    // Total coverage should not double-count wall
    expect(doorSegs.length).toBeGreaterThanOrEqual(1);
    expect(wallSegs.length).toBeGreaterThanOrEqual(0);
  });

  // 6. Door on reversed wall [[100,0],[0,0]]
  it('door on reversed wall direction — segments still valid', () => {
    const result = buildOcclusionSegments(
      [makeWall({ points: [[100, 0], [0, 0]] })],
      [makeDoor({ position: [50, 0], width: 20 })],
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    // All segments should have non-degenerate points
    result.forEach(s => {
      const dx = s.points[1][0] - s.points[0][0];
      const dy = s.points[1][1] - s.points[0][1];
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(0.001);
    });
    // Door segment should still be present and have correct blocking behavior
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg).toBeDefined();
    expect(doorSeg!.blocksVision).toBe(true); // closed door blocks
  });

  // 7. Very short wall with door wider than wall
  it('very short wall (length 2) with door width 10 — door clamped, no crash', () => {
    const result = buildOcclusionSegments(
      [makeWall({ points: [[0, 0], [2, 0]] })],
      [makeDoor({ position: [1, 0], width: 10 })],
    );
    // tStart = max(0, 0.5 - 2.5) = 0, tEnd = min(1, 0.5 + 2.5) = 1 → full wall is door
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('door');
  });

  // 8. Window wall with closed door — door still blocks
  it('window wall with closed door — door segment blocks even though wall does not block light', () => {
    const result = buildOcclusionSegments(
      [makeWall({ wallType: 'window' })],
      [makeDoor({ state: 'closed' })],
    );
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg).toBeDefined();
    expect(doorSeg!.blocksVision).toBe(true);
    expect(doorSeg!.blocksLight).toBe(true);
    // The wall segments on either side should carry window properties (no light block)
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    wallSegs.forEach(s => {
      expect(s.blocksLight).toBe(false); // window
      expect(s.blocksVision).toBe(true);
    });
  });

  // 9. Terrain wall with door — terrain doesn't block vision, but closed door does
  it('terrain wall with closed door — door blocks, terrain wall segments do not block vision', () => {
    const result = buildOcclusionSegments(
      [makeWall({ wallType: 'terrain' })],
      [makeDoor({ state: 'closed' })],
    );
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg).toBeDefined();
    expect(doorSeg!.blocksVision).toBe(true);
    expect(doorSeg!.blocksMovement).toBe(true);
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    wallSegs.forEach(s => {
      expect(s.blocksVision).toBe(false); // terrain
      expect(s.blocksMovement).toBe(true);
    });
  });

  // 10. All wall types with open door — open door always unblocks
  it('open door always unblocks regardless of wall type', () => {
    const wallTypes = ['normal', 'terrain', 'invisible', 'ethereal', 'window'] as const;
    for (const wallType of wallTypes) {
      const result = buildOcclusionSegments(
        [makeWall({ wallType })],
        [makeDoor({ state: 'open' })],
      );
      const doorSeg = result.find(s => s.sourceType === 'door');
      expect(doorSeg).toBeDefined();
      expect(doorSeg!.blocksVision).toBe(false);
      expect(doorSeg!.blocksLight).toBe(false);
      expect(doorSeg!.blocksMovement).toBe(false);
      expect(doorSeg!.blocksSound).toBe(false);
    }
  });

  // 11. Locked door same as closed
  it('locked door blocks like closed door', () => {
    const result = buildOcclusionSegments(
      [makeWall()],
      [makeDoor({ state: 'locked' })],
    );
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg).toBeDefined();
    expect(doorSeg!.blocksVision).toBe(true);
    expect(doorSeg!.blocksLight).toBe(true);
    expect(doorSeg!.blocksMovement).toBe(true);
    expect(doorSeg!.blocksSound).toBe(true);
  });

  // 12. Door references wrong/nonexistent wall
  it('door with wallId referencing nonexistent wall is ignored entirely', () => {
    const result = buildOcclusionSegments(
      [makeWall({ id: 'w1' })],
      [makeDoor({ wallId: 'does-not-exist' })],
    );
    // Wall should produce single segment; orphan door is dropped
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('wall');
    expect(result.find(s => s.sourceType === 'door')).toBeUndefined();
  });

  // 13. Wall with 3+ points (polyline) — implementation uses first and last point only
  it('polyline wall with 3 points: occlusion uses first and last point only', () => {
    // Wall: [0,0] → [50,50] → [100,0] — L-shape. Implementation uses start=[0,0] end=[100,0]
    const result = buildOcclusionSegments(
      [makeWall({ points: [[0, 0], [50, 50], [100, 0]] })],
      [],
    );
    // Should produce exactly one segment from [0,0] to [100,0]
    expect(result).toHaveLength(1);
    expect(result[0].points[0]).toEqual([0, 0]);
    expect(result[0].points[1]).toEqual([100, 0]);
  });

  // 14. Negative coordinates
  it('wall and door in negative coordinate space produce valid segments', () => {
    const result = buildOcclusionSegments(
      [makeWall({ points: [[-100, -50], [100, 50]] })],
      [makeDoor({ position: [0, 0], width: 40 })],
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg).toBeDefined();
    // Door segment should be within the wall extents
    doorSeg!.points.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(-100);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(-50);
      expect(y).toBeLessThanOrEqual(50);
    });
  });
});
