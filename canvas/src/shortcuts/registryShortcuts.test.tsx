import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createRegistry, registry, type FamilyDef, type Registry, type ToolDef } from '@/editor/registry';
import { RegistryProvider } from '@/editor/shell/RegistryProvider';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { shellShortcuts } from '@/editor/shell/shellKeys';
import { stubInput } from '@/editor/shell/stub/stubRegistry';
import { withStubs } from '@/editor/shell/stub/withStubs';
import { ShortcutsSheet } from '@/editor/surfaces/ShortcutsSheet';
import { handleShortcut, setRegistryShortcuts } from './defaultShortcuts';
import { formatCombo } from './formatCombo';
import { keyCollisions, PREVIOUS_TOOL_KEY, reservedViolations, shortcutTable } from './registryShortcuts';

const nextRegistry = createRegistry(withStubs(registry, stubInput));

/** The registry with one family's tools changed. */
function withFamily(reg: Registry, id: FamilyDef['id'], tools: (t: readonly ToolDef[]) => ToolDef[]): Registry {
  return createRegistry({ ...reg, families: reg.families.map((f) => (f.id === id ? { ...f, tools: tools(f.tools) } : f)) });
}

const keyed = (t: ToolDef, key: string): ToolDef => ({ ...t, key });

beforeEach(() => {
  useStore.getState().resetToDefault();
  resetShell();
});

afterEach(() => {
  setRegistryShortcuts(null);
  cleanup();
});

describe.each([
  ['the registered registry', registry],
  ['the /next registry, stubs filling the families not registered yet', nextRegistry],
])('%s', (_name, reg) => {
  it('has no two keys live on one combo at once', () => {
    expect(keyCollisions(reg, shellShortcuts(reg))).toEqual([]);
  });

  it('keeps the reserved letters for their owners', () => {
    expect(reservedViolations(shellShortcuts(reg))).toEqual([]);
  });
});

describe('the collision test fails when', () => {
  const design = (tools: (t: readonly ToolDef[]) => ToolDef[]) => withFamily(registry, 'design', tools);

  it('a tool takes a rail key', () => {
    const reg = design((t) => [keyed(t[0], 'V'), ...t.slice(1)]);
    expect(keyCollisions(reg, shellShortcuts(reg)).map((c) => c.combo)).toContain('v');
  });

  it('two tools in a family share a key', () => {
    const reg = design((t) => [t[0], keyed(t[1], t[0].key), ...t.slice(2)]);
    expect(keyCollisions(reg, shellShortcuts(reg)).map((c) => c.combo)).toContain(registry.families[0].tools[0].key.toLowerCase());
  });

  it('a tool takes a family key', () => {
    const reg = design((t) => [t[0], keyed(t[1], 'T'), ...t.slice(2)]);
    expect(keyCollisions(reg, shellShortcuts(reg)).map((c) => c.combo)).toContain('t');
  });

  it('a dock key takes a global chord', () => {
    const reg = design((t) => [{ ...t[0], keys: [{ id: 'x', combo: 'i', label: 'Clash' }] }, ...t.slice(1)]);
    expect(keyCollisions(reg, shellShortcuts(reg)).map((c) => c.combo)).toContain('i');
  });

  it('a tool takes a reserved letter', () => {
    const reg = design((t) => [t[0], keyed(t[1], 'N'), ...t.slice(2)]);
    expect(reservedViolations(shellShortcuts(reg)).map((k) => k.combo)).toEqual(['n']);
  });
});

describe('the shortcuts sheet', () => {
  it('lists every registered rail, family and tool key from the one table', () => {
    const keys = shellShortcuts(nextRegistry);
    const rows = shortcutTable(nextRegistry, keys).flatMap((s) => s.rows);
    const { getByTestId } = render(
      <RegistryProvider registry={nextRegistry}>
        <ShortcutsSheet onClose={() => {}} />
      </RegistryProvider>,
    );
    const sheet = getByTestId('shell-shortcuts');
    const expected = [
      ...nextRegistry.rail.map((t) => ({ id: `rail.${t.id}`, key: t.key })),
      ...nextRegistry.families.map((f) => ({ id: `family.${f.id}`, key: f.key })),
      ...nextRegistry.families.flatMap((f) => f.tools.map((t) => ({ id: `tool.${t.id}`, key: t.key }))),
      { id: 'tool.previous', key: PREVIOUS_TOOL_KEY },
    ];
    for (const { id, key } of expected) {
      expect(rows.some((r) => r.id === id && r.keys.includes(formatCombo(key.toLowerCase())))).toBe(true);
      const row = sheet.querySelector(`[data-key-row="${id}"]`);
      expect(row?.textContent).toContain(formatCombo(key.toLowerCase()));
    }
    // And the hand-written chords, from the same table.
    expect(sheet.querySelector('[data-key-row="edit.undo"]')).not.toBeNull();
  });
});

describe('keys in the new shell', () => {
  beforeEach(() => setRegistryShortcuts(shellShortcuts(registry)));

  it('opens a family with its key and picks a tool with the tool key', () => {
    expect(handleShortcut('d')).toBe(true);
    expect(useShell.getState().flyout).toBe('design');
    expect(handleShortcut('f')).toBe(true);
    expect(useShell.getState().flyout).toBeNull();
    expect(registry.toolById('floor')!.engine).toContain(useStore.getState().tools.activeTool);
  });

  it('answers a family\'s tool keys straight away while one of its tools is in hand', () => {
    useStore.getState().setActiveTool('rectangle');
    expect(handleShortcut('w')).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('wall');
  });

  it('answers a tool\'s dock keys while it is in hand', () => {
    useStore.getState().setActiveTool('rectangle');
    expect(handleShortcut('p')).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('polygon');
    useStore.getState().setActiveTool('wall');
    expect(handleShortcut('c')).toBe(true);
    expect(useStore.getState().tools.curveMode).toBe(true);
  });

  it('goes back to the last family tool from Select', () => {
    useShell.getState().setLastTool('wall');
    useStore.getState().setActiveTool('select');
    expect(handleShortcut(PREVIOUS_TOOL_KEY)).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('wall');
  });

  it('keeps the old editor\'s keys out of the way', () => {
    useStore.getState().setActiveTool('select');
    // The old editor's D is Door; here it is the Design family.
    handleShortcut('d');
    expect(useStore.getState().tools.activeTool).toBe('select');
  });
});

describe('keys in the old editor', () => {
  it('are the table\'s own while no shell installs the registry\'s', () => {
    setRegistryShortcuts(null);
    expect(handleShortcut('d')).toBe(true);
    expect(useStore.getState().tools.activeTool).toBe('door');
  });
});
