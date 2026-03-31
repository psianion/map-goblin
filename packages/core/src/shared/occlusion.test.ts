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

describe('buildOcclusionSegments', () => {
  it('wall with no doors produces one segment', () => {
    const result = buildOcclusionSegments([makeWall()], []);
    expect(result).toHaveLength(1);
    expect(result[0].blocksVision).toBe(true);
    expect(result[0].blocksLight).toBe(true);
    expect(result[0].sourceType).toBe('wall');
  });

  it('terrain wall does not block vision or light', () => {
    const result = buildOcclusionSegments([makeWall({ wallType: 'terrain' })], []);
    expect(result[0].blocksVision).toBe(false);
    expect(result[0].blocksLight).toBe(false);
    expect(result[0].blocksMovement).toBe(true);
  });

  it('ethereal wall blocks vision but not movement', () => {
    const result = buildOcclusionSegments([makeWall({ wallType: 'ethereal' })], []);
    expect(result[0].blocksVision).toBe(true);
    expect(result[0].blocksMovement).toBe(false);
  });

  it('closed door blocks everything', () => {
    const result = buildOcclusionSegments([makeWall()], [makeDoor({ state: 'closed' })]);
    expect(result).toHaveLength(3);
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg!.blocksVision).toBe(true);
    expect(doorSeg!.blocksLight).toBe(true);
  });

  it('open door blocks nothing', () => {
    const result = buildOcclusionSegments([makeWall()], [makeDoor({ state: 'open' })]);
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg!.blocksVision).toBe(false);
    expect(doorSeg!.blocksLight).toBe(false);
    expect(doorSeg!.blocksMovement).toBe(false);
  });

  it('archway always non-blocking regardless of state', () => {
    const result = buildOcclusionSegments([makeWall()], [
      makeDoor({ style: 'archway', state: 'closed' })
    ]);
    const doorSeg = result.find(s => s.sourceType === 'door');
    expect(doorSeg!.blocksVision).toBe(false);
  });

  it('direction is propagated from wall', () => {
    const result = buildOcclusionSegments([makeWall({ direction: 'left' })], []);
    expect(result[0].direction).toBe('left');
  });

  it('multiple doors on one wall split correctly', () => {
    const result = buildOcclusionSegments([makeWall()], [
      makeDoor({ id: 'd1', position: [25, 0], width: 10 }),
      makeDoor({ id: 'd2', position: [75, 0], width: 10 }),
    ]);
    expect(result).toHaveLength(5);
    expect(result.filter(s => s.sourceType === 'wall')).toHaveLength(3);
    expect(result.filter(s => s.sourceType === 'door')).toHaveLength(2);
  });

  it('door wider than wall is clamped', () => {
    const result = buildOcclusionSegments(
      [makeWall({ points: [[0,0],[20,0]] })],
      [makeDoor({ width: 50, position: [10, 0] })]
    );
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('door');
  });

  it('door on nonexistent wall is ignored', () => {
    const result = buildOcclusionSegments([makeWall()], [
      makeDoor({ wallId: 'nonexistent' })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceType).toBe('wall');
  });

  it('zero-length sub-segments are filtered out', () => {
    const result = buildOcclusionSegments(
      [makeWall({ points: [[0,0],[100,0]] })],
      [makeDoor({ position: [0, 0], width: 20 })]
    );
    const wallSegs = result.filter(s => s.sourceType === 'wall');
    wallSegs.forEach(s => {
      const dx = s.points[1][0] - s.points[0][0];
      const dy = s.points[1][1] - s.points[0][1];
      expect(dx * dx + dy * dy).toBeGreaterThan(0);
    });
  });
});
