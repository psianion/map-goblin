import { describe, expect, it } from 'vitest';
import { ALL_ROLES, registerPanel, resolvePanelTitle, usePanel, usePanels, useRailPanels } from './panels';

// Registration is module-global by design (D8), so these ids are namespaced to
// avoid colliding with the panels the real components register on import.
const stub = () => null;
const base = { icon: 'log', key: '', group: 'play' } as const;

describe('panel registry', () => {
  it('filters by role, sorts by order, and replaces on re-register', () => {
    registerPanel({ id: 't-log', roles: ALL_ROLES, order: 50, component: stub, ...base });
    registerPanel({ id: 't-dm', roles: ['dm'], order: 0, component: stub, ...base });
    registerPanel({ id: 't-dm', title: 'Second take', roles: ['dm'], order: 0, component: stub, ...base });

    const dm = usePanels('dm').filter((p) => p.id.startsWith('t-'));
    expect(dm.map((p) => p.id)).toEqual(['t-dm', 't-log']);
    expect(dm[0].title).toBe('Second take'); // replaced, not duplicated

    expect(usePanels('player').filter((p) => p.id.startsWith('t-')).map((p) => p.id)).toEqual([
      't-log',
    ]);
    expect(usePanels(undefined)).toEqual([]);
  });

  it('drops rail:false panels from useRailPanels but keeps them findable by usePanel', () => {
    registerPanel({ id: 't-hidden', roles: ALL_ROLES, order: 99, component: stub, ...base, rail: false });
    registerPanel({ id: 't-shown', roles: ALL_ROLES, order: 98, component: stub, ...base });

    const rail = useRailPanels('dm').map((p) => p.id);
    expect(rail).toContain('t-shown');
    expect(rail).not.toContain('t-hidden');
    expect(usePanel('t-hidden')?.id).toBe('t-hidden');
    expect(usePanel('does-not-exist')).toBeUndefined();
  });

  it('resolves a function title live and falls back to the id', () => {
    let name = 'Fieldstone Keep';
    registerPanel({
      id: 't-dynamic-title',
      roles: ALL_ROLES,
      order: 1,
      component: stub,
      ...base,
      title: () => name,
    });
    const def = usePanel('t-dynamic-title')!;
    expect(resolvePanelTitle(def)).toBe('Fieldstone Keep');
    name = 'The Vestry';
    expect(resolvePanelTitle(def)).toBe('The Vestry');

    registerPanel({ id: 't-no-title', roles: ALL_ROLES, order: 1, component: stub, ...base });
    expect(resolvePanelTitle(usePanel('t-no-title')!)).toBe('t-no-title');
  });
});
