import { describe, it, expect } from 'vitest';
import { detectAssetType } from './detect.js';

describe('detectAssetType', () => {
  it('detects square image as floor', () => {
    expect(detectAssetType({ width: 200, height: 200, folder: '' })).toBe('floor');
  });

  it('detects wide image as wall', () => {
    expect(detectAssetType({ width: 600, height: 200, folder: '' })).toBe('wall');
  });

  it('detects tall image as portal', () => {
    expect(detectAssetType({ width: 200, height: 400, folder: '' })).toBe('portal');
  });

  it('uses folder hint over aspect ratio', () => {
    expect(detectAssetType({ width: 200, height: 200, folder: 'objects' })).toBe('object');
  });

  it('maps folder names to types', () => {
    expect(detectAssetType({ width: 200, height: 200, folder: 'walls' })).toBe('wall');
    expect(detectAssetType({ width: 200, height: 200, folder: 'scatter' })).toBe('scatter');
    expect(detectAssetType({ width: 200, height: 200, folder: 'portals' })).toBe('portal');
    expect(detectAssetType({ width: 200, height: 200, folder: 'paths' })).toBe('path');
    expect(detectAssetType({ width: 200, height: 200, folder: 'light-masks' })).toBe('light-mask');
    expect(detectAssetType({ width: 200, height: 200, folder: 'patterns' })).toBe('pattern');
    expect(detectAssetType({ width: 200, height: 200, folder: 'edges' })).toBe('edge');
  });

  it('handles small scatter-sized images', () => {
    expect(detectAssetType({ width: 64, height: 64, folder: '' })).toBe('scatter');
  });
});
