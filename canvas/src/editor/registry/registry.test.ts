import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDefaultState } from '@/store/factories';
import { createRegistry, defineCard, defineCardField, registry, type RegistryInput, type SettingDef, type ToolDef } from './index';
import { RULES, validateRegistry, type Rule } from './validate';
import { fixtureFamily, fixtureInput, secret, shapeTool, sides } from './registry.fixture';
import { editCurve, gridSnap } from './shared';

const fresh = () => createDefaultState();

function rulesBroken(input: RegistryInput): Rule[] {
  return [...new Set(validateRegistry(input, fresh()).map((p) => p.rule))];
}

/** A copy of a def with some fields changed, typed loosely on purpose: it may be broken. */
function edit(def: SettingDef, patch: Record<string, unknown>): SettingDef {
  return { ...def, ...patch } as unknown as SettingDef;
}

/** The fixture with its first tool replaced. */
function withTool(patch: Partial<ToolDef>, extra: ToolDef[] = []): RegistryInput {
  const tools = [{ ...shapeTool, ...patch }, ...fixtureFamily.tools.slice(1), ...extra];
  return { ...fixtureInput(), families: [{ ...fixtureFamily, tools }] };
}

describe('the registered registry', () => {
  const problems = validateRegistry(registry, fresh());

  it.each(RULES)('keeps the rule %s', (rule) => {
    expect(problems.filter((p) => p.rule === rule)).toEqual([]);
  });
});

describe('the rules, proven on a fixture', () => {
  it('pass on the valid fixture', () => {
    expect(validateRegistry(fixtureInput(), fresh())).toEqual([]);
  });

  it('let one definition be referenced by many tools', () => {
    const tools = fixtureFamily.tools;
    expect(tools.every((t) => t.settings.includes(gridSnap) && t.settings.includes(editCurve))).toBe(true);
    expect(rulesBroken(fixtureInput())).toEqual([]);
  });

  const breakages: [string, Rule, () => RegistryInput][] = [
    [
      'two definitions share an id',
      'unique-id',
      () => withTool({ settings: [...shapeTool.settings, edit(secret, {})] }),
    ],
    [
      'a card field reuses a tool setting id',
      'unique-id',
      () => ({
        ...fixtureInput(),
        cards: [
          defineCard({
            kind: 'door',
            title: () => 'Door',
            verbs: [],
            fields: [
              defineCardField<'door', boolean>({
                id: 'fixture.secret', label: 'Secret', schema: z.boolean(), default: false,
                home: 'card', control: 'switch', read: () => false, write: () => {},
              }),
            ],
          }),
        ],
      }),
    ],
    [
      'a tool lists a setting homed on the card',
      'one-home',
      () => withTool({ settings: [edit(secret, { id: 'fixture.c', home: 'card' })] }),
    ],
    [
      'a setting has no valid home',
      'one-home',
      () => withTool({ settings: [edit(secret, { home: 'nowhere' })] }),
    ],
    ['a family takes a rail key', 'unique-key', () => ({ ...fixtureInput(), families: [{ ...fixtureFamily, key: 'v' }] })],
    ['two tools in a family share a key', 'unique-key', () => withTool({ key: 'w' })],
    [
      'a custom control has no render',
      'custom-render',
      () => withTool({ settings: [edit(secret, { control: 'custom' })] }),
    ],
    [
      'a default does not parse',
      'default-parses',
      () => withTool({ settings: [edit(sides, { default: 99 })] }),
    ],
    ['a tool has no hint', 'has-hint', () => withTool({ hint: undefined as unknown as ToolDef['hint'] })],
    [
      'a path reads nothing in the core store',
      'binding',
      () => withTool({ settings: [edit(sides, { path: 'noSuch.sides' })] }),
    ],
    [
      'a default disagrees with the core default',
      'binding',
      () => withTool({ settings: [edit(sides, { default: 6 })] }),
    ],
    [
      'a setting has neither path nor bind',
      'binding',
      () => withTool({ settings: [edit(secret, { path: undefined })] }),
    ],
  ];

  it.each(breakages)('fail when %s', (_name, rule, input) => {
    expect(rulesBroken(input())).toEqual([rule]);
  });
});

describe('lookups', () => {
  const reg = createRegistry(fixtureInput());

  it('find tools, settings and families by id', () => {
    expect(reg.toolById('fixture')).toBe(shapeTool);
    expect(reg.toolById('select')?.key).toBe('V');
    expect(reg.settingById('fixture.sides')).toBe(sides);
    expect(reg.settingById('grid.snap')).toBe(gridSnap);
    expect(reg.familyOfTool('fixture')).toBe(fixtureFamily);
    expect(reg.familyOfTool('select')).toBeUndefined();
    expect(reg.cardForKind('door')).toBeUndefined();
  });

  it('split a tool by home in the order it lists its settings', () => {
    const ids = (home: 'dock' | 'panel' | 'card') => reg.settingsByHome('fixture', home).map((s) => s.id);
    expect(ids('dock')).toEqual(['fixture.sides', 'edit.curve', 'edit.nodeMode', 'fixture.scale']);
    expect(ids('panel')).toEqual(['fixture.secret', 'grid.snap', 'fixture.scaleRange']);
    expect(ids('card')).toEqual([]);
  });
});
