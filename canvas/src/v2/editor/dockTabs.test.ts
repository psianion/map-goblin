import { describe, it, expect } from 'vitest';
import { DOCK_TABS, hasSwatches, tabForTool } from './dockTabs';

describe('dock tabs', () => {
  it('has one Props tool on B, the brush in Stamp and Scatter modes', () => {
    const props = DOCK_TABS.find((t) => t.id === 'props');
    expect(props?.tools.map((t) => [t.tool, t.label, t.shortcut])).toEqual([['scatterBrush', 'Props', 'B']]);
    expect(tabForTool('scatterBrush')).toBe('props');
    expect(hasSwatches('scatterBrush', 'props')).toBe(true);
  });
});
