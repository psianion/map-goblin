import { describe, it, expect } from 'vitest';
import { CORE_VERSION } from './index';

describe('@dnd/core', () => {
  it('exports package version', () => {
    expect(CORE_VERSION).toBe('0.0.1');
  });
});
