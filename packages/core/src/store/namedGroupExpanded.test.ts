import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { isNamedGroupExpanded, isChildGroupExpanded, namedGroupKey } from './selectors';

describe('isNamedGroupExpanded', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('defaults to collapsed — the inverse of a type bucket', () => {
    const s = useStore.getState();
    expect(isNamedGroupExpanded(s, 'layer-1', 'g1')).toBe(false);
    expect(isChildGroupExpanded(s, 'layer-1', 'door')).toBe(true);
  });

  it('toggles through the shared override set', () => {
    useStore.getState().toggleChildGroup(namedGroupKey('layer-1', 'g1'));
    expect(isNamedGroupExpanded(useStore.getState(), 'layer-1', 'g1')).toBe(true);
    // Scoped to its own layer and group.
    expect(isNamedGroupExpanded(useStore.getState(), 'layer-2', 'g1')).toBe(false);
    expect(isNamedGroupExpanded(useStore.getState(), 'layer-1', 'g2')).toBe(false);

    useStore.getState().toggleChildGroup(namedGroupKey('layer-1', 'g1'));
    expect(isNamedGroupExpanded(useStore.getState(), 'layer-1', 'g1')).toBe(false);
  });

  it('does not collide with a type bucket key', () => {
    useStore.getState().toggleChildGroup(namedGroupKey('layer-1', 'asset'));
    expect(isChildGroupExpanded(useStore.getState(), 'layer-1', 'asset')).toBe(false);
    expect(isNamedGroupExpanded(useStore.getState(), 'layer-1', 'asset')).toBe(true);
  });
});
