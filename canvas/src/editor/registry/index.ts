// The registry: every family, tool, setting and card as data, and the lookups the
// surfaces render from. Families register here as they move over (steps 7, 10 to 14).

import { RAIL_TOOLS } from './rail';
import { SHARED_SETTINGS } from './shared';
import { DESIGN_CARDS, design } from '@/editor/families/design';
import type { CardDef, FamilyDef, Home, ObjectKind, SettingDef, ToolDef } from './types';

export * from './types';
export { defineCard, defineCardField, defineFamily, defineSetting, defineTool } from './define';
export { bindingOf, settingsPath } from './binding';

export interface RegistryInput {
  /** Select, Pan and Measure, above the families. */
  rail: ReadonlyArray<ToolDef>;
  families: ReadonlyArray<FamilyDef>;
  /** Settings defined once and referenced by many tools (registry/shared.ts). */
  shared: ReadonlyArray<SettingDef>;
  cards: ReadonlyArray<CardDef>;
}

export interface Registry extends RegistryInput {
  /** Every tool: the rail's, then each family's in order. */
  tools: ReadonlyArray<ToolDef>;
  toolById(id: string): ToolDef | undefined;
  settingById(id: string): SettingDef | undefined;
  /** Undefined for the rail's own tools. */
  familyOfTool(toolId: string): FamilyDef | undefined;
  cardForKind<K extends ObjectKind>(kind: K): CardDef<K> | undefined;
  /** A tool's settings that render in `home`, in the tool's order. */
  settingsByHome(toolId: string, home: Home): SettingDef[];
}

export function createRegistry(input: RegistryInput): Registry {
  const tools = [...input.rail, ...input.families.flatMap((f) => f.tools)];
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const familyMap = new Map(input.families.flatMap((f) => f.tools.map((t) => [t.id, f] as const)));
  const settingMap = new Map<string, SettingDef>();
  for (const s of [...input.shared, ...tools.flatMap((t) => t.settings)]) settingMap.set(s.id, s);
  const cardMap = new Map(input.cards.map((c) => [c.kind, c]));
  return {
    ...input,
    tools,
    toolById: (id) => toolMap.get(id),
    settingById: (id) => settingMap.get(id),
    familyOfTool: (toolId) => familyMap.get(toolId),
    cardForKind: <K extends ObjectKind>(kind: K) => cardMap.get(kind) as CardDef<K> | undefined,
    settingsByHome: (toolId, home) => (toolMap.get(toolId)?.settings ?? []).filter((s) => s.home === home),
  };
}

const families: FamilyDef[] = [design];
const cards: CardDef[] = [...DESIGN_CARDS];

export const registry = createRegistry({ rail: RAIL_TOOLS, families, shared: SHARED_SETTINGS, cards });

export const { toolById, settingById, familyOfTool, cardForKind, settingsByHome } = registry;
