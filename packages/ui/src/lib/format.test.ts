import { describe, expect, it } from 'vitest';
import { formatBytes, progressDetail, progressFraction } from './format';

describe('formatBytes', () => {
  it('reads KB under a megabyte and MB with one decimal above', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(640 * 1024)).toBe('640 KB');
    expect(formatBytes(3.1 * 1024 * 1024)).toBe('3.1 MB');
  });
});

describe('progress', () => {
  it('is null with nothing counted, by bytes when sizes are known, by files otherwise', () => {
    expect(progressFraction(null)).toBeNull();
    expect(progressFraction({ filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 })).toBeNull();
    expect(progressFraction({ filesDone: 1, filesTotal: 4, bytesDone: 3, bytesTotal: 4 })).toBe(0.75);
    expect(progressFraction({ filesDone: 1, filesTotal: 4, bytesDone: 0, bytesTotal: 0 })).toBe(0.25);
  });

  it('writes the detail line', () => {
    expect(progressDetail({ filesDone: 12, filesTotal: 40, bytesDone: 3.1 * 1024 * 1024, bytesTotal: 7.8 * 1024 * 1024 })).toBe(
      '12 of 40 files · 3.1 MB of 7.8 MB',
    );
  });
});
