import type { Role } from '@dnd/core/src/shared/protocol';
import { dockTabs } from './dock/registry';
import { BINDINGS, CAMERA_KEYS } from './hotkeys';
import { railToolsFor } from './rail/registry';

export interface ShortcutRow {
  id: string;
  label: string;
  keys: string[];
}
export interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const caption = (key: string, shift?: boolean): string => {
  const k = key.length === 1 ? key.toUpperCase() : key;
  return shift ? `Shift+${k}` : k;
};

/** Board 9's list, generated from the rail and dock registries plus the fixed bindings. */
export function shortcutTable(role: Role): ShortcutSection[] {
  const sections: ShortcutSection[] = [
    { title: 'Tools', rows: railToolsFor(role).map((t) => ({ id: `rail:${t.id}`, label: t.title, keys: [t.key] })) },
  ];
  if (role === 'dm') {
    sections.push({ title: 'Dock', rows: dockTabs().map((t) => ({ id: `dock:${t.id}`, label: t.title, keys: [t.key] })) });
  }
  for (const b of BINDINGS) {
    if (!b.roles.includes(role)) continue;
    let section = sections.find((s) => s.title === b.group);
    if (!section) sections.push((section = { title: b.group, rows: [] }));
    section.rows.push({ id: `key:${b.shift ? 'shift+' : ''}${b.key}`, label: b.label, keys: [caption(b.key, b.shift)] });
  }
  const view = sections.find((s) => s.title === 'View');
  const cameraRows = CAMERA_KEYS.map((k) => ({ id: `camera:${k.key}`, label: k.label, keys: [k.key === '-' ? '−' : k.key] }));
  if (view) view.rows.unshift(...cameraRows);
  else sections.push({ title: 'View', rows: cameraRows });
  const help = sections.find((s) => s.title === 'Help');
  help?.rows.push({ id: 'key:escape', label: 'Close the card, sheet, dock body, selection, then the tool', keys: ['Esc'] });
  return sections;
}
