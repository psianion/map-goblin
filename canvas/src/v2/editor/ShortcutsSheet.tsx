import { Fragment, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { POINTER_HINTS, SHORTCUT_GROUPS, SHORTCUTS, type ShortcutGroup } from '@/shortcuts/defaultShortcuts';
import { formatCombo, isMac } from '@/shortcuts/formatCombo';
import type { ToolType } from '@/store/types';
import { SlideOver } from './SlideOver';
import { DOCK_TABS, tabForTool } from './dockTabs';
import './rooms.css';
import './shortcuts.css';

/*
 * The Keyboard shortcuts sheet: every key the map answers, read from the one shortcut
 * table, grouped as the help groups it (the tools by dock tab), with a filter. Opened by ?
 * and from the title menu.
 */

interface Row {
  id: string;
  label: string;
  combos: string[];
}

interface Part {
  /** The dock tab (or the rail) a run of tool rows belongs to. */
  caption?: string;
  rows: Row[];
}

interface Section {
  group: ShortcutGroup;
  parts: Part[];
}

/** The tool a Tools row picks or belongs to: its scope's, else its id's ('tool.wall'). */
function toolOf(id: string, scope?: string): ToolType | null {
  if (scope?.startsWith('tool:')) return scope.slice('tool:'.length) as ToolType;
  return id.startsWith('tool.') ? (id.slice('tool.'.length) as ToolType) : null;
}

/** Where a Tools row sits: its dock tab's name, or the rail for the tools and modes it holds. */
function captionOf(id: string, scope?: string): string {
  const tool = toolOf(id, scope);
  const tab = tool ? tabForTool(tool) : null;
  return DOCK_TABS.find((t) => t.id === tab)?.label ?? 'Rail';
}

const CAPTIONS = ['Rail', ...DOCK_TABS.map((t) => t.label)];

/** The table as the sheet lists it: one row per action, aliases left out, mouse gestures in. */
function buildSections(): Section[] {
  const rows = new Map<string, Row & { group: ShortcutGroup; caption?: string }>();
  const entries = [
    ...SHORTCUTS.filter((s) => !s.alias),
    ...POINTER_HINTS.map((p) => ({ ...p, scope: undefined })),
  ];
  for (const s of entries) {
    const row = rows.get(s.id);
    if (row) {
      if (!row.combos.includes(s.combo)) row.combos.push(s.combo);
      continue;
    }
    const caption = s.group === 'Tools' ? captionOf(s.id, s.scope) : undefined;
    rows.set(s.id, { id: s.id, label: s.label, combos: [s.combo], group: s.group, caption });
  }
  return SHORTCUT_GROUPS.map((group) => {
    const inGroup = [...rows.values()].filter((r) => r.group === group);
    if (group !== 'Tools') return { group, parts: [{ rows: inGroup }] };
    return {
      group,
      parts: CAPTIONS.map((caption) => ({ caption, rows: inGroup.filter((r) => r.caption === caption) })).filter(
        (p) => p.rows.length > 0,
      ),
    };
  });
}

const SECTIONS = buildSections();

/** The sections with only the rows the filter finds: by label, by key, or by heading. */
function filterSections(query: string, mac: boolean): Section[] {
  const q = query.trim().toLowerCase();
  if (!q) return SECTIONS;
  const hit = (text: string) => text.toLowerCase().includes(q);
  return SECTIONS.map((s) => ({
    group: s.group,
    parts: s.parts
      .map((p) => ({
        caption: p.caption,
        rows:
          hit(s.group) || (p.caption && hit(p.caption))
            ? p.rows
            : p.rows.filter((r) => hit(r.label) || r.combos.some((c) => hit(formatCombo(c, mac)))),
      }))
      .filter((p) => p.rows.length > 0),
  })).filter((s) => s.parts.length > 0);
}

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const mac = isMac();
  const sections = useMemo(() => filterSections(query, mac), [query, mac]);

  return (
    <SlideOver
      title="Keyboard shortcuts"
      open={open}
      onClose={onClose}
      testId="v2-shortcuts-sheet"
      legacy={false}
      className="v2-keys"
    >
      <div className="v2-keys__top">
        <label className="v2-rfilter">
          <Search size={14} strokeWidth={1.75} aria-hidden />
          <input
            value={query}
            placeholder="Filter shortcuts"
            aria-label="Filter shortcuts"
            spellCheck={false}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Keys typed here are not canvas shortcuts; Escape empties the field, then closes.
              e.stopPropagation();
              if (e.key !== 'Escape') return;
              if (query) setQuery('');
              else onClose();
            }}
          />
        </label>
      </div>
      {sections.length === 0 ? (
        <p className="v2-keys__empty">No shortcut matches “{query.trim()}”.</p>
      ) : (
        sections.map((s) => (
          <section key={s.group} className="v2-keys__group" aria-label={s.group}>
            <h3 className="v2-keys__head">{s.group}</h3>
            {s.parts.map((p) => (
              <Fragment key={p.caption ?? s.group}>
                {p.caption && <div className="v2-keys__caption">{p.caption}</div>}
                <ul className="v2-keys__list">
                  {p.rows.map((r) => (
                    <li key={r.id} className="v2-keys__row" data-testid="v2-shortcut-row">
                      <span className="v2-keys__label">{r.label}</span>
                      <span className="v2-keys__combos">
                        {r.combos.map((c) => (
                          <kbd key={c}>{formatCombo(c, mac)}</kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))}
          </section>
        ))
      )}
    </SlideOver>
  );
}
