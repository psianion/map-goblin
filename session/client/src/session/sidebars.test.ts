import { describe, expect, it } from 'vitest';
import { registerSidebar, sidebarForRole } from './sidebars';

const stub = () => null;

describe('sidebar registry', () => {
  it('keeps one def per role and replaces on re-register', () => {
    registerSidebar('dm', { title: 'Prep', component: stub });
    expect(sidebarForRole('dm')?.title).toBe('Prep');

    registerSidebar('dm', { title: 'Prep v2', component: stub });
    expect(sidebarForRole('dm')?.title).toBe('Prep v2');
  });

  it('keeps the DM and player defs independent', () => {
    registerSidebar('dm', { title: 'Prep', component: stub });
    registerSidebar('player', { title: 'Journal', component: stub });
    expect(sidebarForRole('dm')?.title).toBe('Prep');
    expect(sidebarForRole('player')?.title).toBe('Journal');
  });

  it('is undefined for no role and for a role nothing registered', () => {
    expect(sidebarForRole(undefined)).toBeUndefined();
  });

  it('carries an optional live badge', () => {
    let count = 0;
    registerSidebar('dm', { title: 'Prep', component: stub, badge: () => (count > 0 ? count : null) });
    expect(sidebarForRole('dm')?.badge?.()).toBeNull();
    count = 3;
    expect(sidebarForRole('dm')?.badge?.()).toBe(3);
  });
});
