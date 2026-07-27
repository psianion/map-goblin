import { describe, expect, it } from 'vitest';
import { ALL_ROLES, registerPanel, usePanels } from './panels';

// Registration is module-global by design (D8), so these ids are namespaced to
// avoid colliding with the panels the real components register on import.
const stub = () => null;

describe('panel registry', () => {
  it('filters by role, sorts by order, and replaces on re-register', () => {
    registerPanel({ id: 't-log', roles: ALL_ROLES, order: 50, component: stub });
    registerPanel({ id: 't-dm', roles: ['dm'], order: 0, component: stub });
    registerPanel({ id: 't-dm', title: 'Second take', roles: ['dm'], order: 0, component: stub });

    const dm = usePanels('dm').filter((p) => p.id.startsWith('t-'));
    expect(dm.map((p) => p.id)).toEqual(['t-dm', 't-log']);
    expect(dm[0].title).toBe('Second take'); // replaced, not duplicated

    expect(usePanels('player').filter((p) => p.id.startsWith('t-')).map((p) => p.id)).toEqual([
      't-log',
    ]);
    expect(usePanels(undefined)).toEqual([]);
  });
});
