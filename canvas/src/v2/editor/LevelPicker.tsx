import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { RenameLevelCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { cn } from '@/lib/utils';
import { FloatMenu, type FloatMenuEntry } from './FloatMenu';
import { LevelIcon } from './roomIcons';
import { addLevelWithLayer } from './roomActions';
import { layerOnLevel } from './roomModel';
import { moveLayerToLevel, openLevelMenuRef, reorderLevel } from './layerActions';
import { LevelDeleteDialog } from './LevelDeleteDialog';
import './rooms.css';

type Mode = 'menu' | 'move' | null;

/**
 * The level picker in front of the layer tiles (boards 8, L4): the level on show, and how
 * many there are. Its menu switches level (Page Up and Page Down do too), adds one (with a
 * first layer to draw on), renames or moves the one on show, moves the active layer to
 * another, opens Level settings (the Level card in the selection slot), or deletes it.
 */
export function LevelPicker() {
  const levels = useStore(useShallow((s) => s.levels));
  const layers = useStore((s) => s.layers);
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const activeLayerId = useStore((s) => s.ui.activeLayerId);
  const [mode, setMode] = useState<Mode>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  // The title card's level name opens this menu.
  useEffect(() => {
    openLevelMenuRef.current = () => setMode('menu');
    return () => {
      openLevelMenuRef.current = null;
    };
  }, []);

  if (levels.length === 0) return null;
  const index = Math.max(0, levels.findIndex((l) => l.id === activeLevelId));
  const level = levels[index];
  const layerCount = (id: string) => layers.filter((l) => l.type !== 'background' && layerOnLevel(l, levels, id)).length;
  const activeLayer = layers.find((l) => l.id === activeLayerId);

  const commitRename = () => {
    const next = renaming?.trim();
    setRenaming(null);
    if (next && next !== level.name) undoManager.execute(new RenameLevelCommand(level.id, next));
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // The keys that reach a level from the one on show, where they apply.
  const keyFor = (i: number) => (i === index - 1 ? ' · PgUp' : i === index + 1 ? ' · PgDn' : '');

  const mainEntries: FloatMenuEntry[] = [
    ...levels.map(
      (l, i): FloatMenuEntry => ({
        label: l.name || 'Unnamed level',
        checked: l.id === level.id,
        meta: `${plural(layerCount(l.id), 'layer')}${keyFor(i)}`,
        testId: `v2-level-${l.id}`,
        onSelect: () => {
          const s = useStore.getState();
          s.setActiveLevelId(l.id);
          s.setSelectedIds([]);
        },
      }),
    ),
    'divider',
    { label: 'New level', testId: 'v2-level-new', onSelect: () => addLevelWithLayer() },
    { label: 'Rename level', testId: 'v2-level-rename', onSelect: () => setRenaming(level.name) },
    {
      label: 'Move level up',
      testId: 'v2-level-up',
      disabled: index === 0,
      onSelect: () => reorderLevel(index, index - 1),
    },
    {
      label: 'Move level down',
      testId: 'v2-level-down',
      disabled: index >= levels.length - 1,
      onSelect: () => reorderLevel(index, index + 1),
    },
    {
      label: 'Move layer to level…',
      testId: 'v2-level-move',
      disabled: levels.length < 2 || !activeLayer || activeLayer.type === 'background',
      onSelect: () => setMode('move'),
    },
    {
      label: 'Level settings',
      testId: 'v2-level-settings',
      onSelect: () => useStore.getState().setSelectedIds([level.id]),
    },
    'divider',
    {
      label: 'Delete level…',
      testId: 'v2-level-delete',
      disabled: levels.length < 2,
      onSelect: () => setDeleting(level.id),
    },
  ];

  const moveEntries: FloatMenuEntry[] = levels
    .filter((l) => l.id !== level.id)
    .map((l) => ({
      label: l.name || 'Unnamed level',
      meta: plural(layerCount(l.id), 'layer'),
      onSelect: () => {
        if (activeLayer) moveLayerToLevel(activeLayer.id, l.id);
      },
    }));

  return (
    <div className="v2-level" data-testid="v2-level-picker">
      {renaming !== null ? (
        <input
          className="v2-level__rename"
          aria-label="Level name"
          value={renaming}
          autoFocus
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(null);
          }}
        />
      ) : (
        <button
          ref={anchor}
          type="button"
          className={cn('v2-level__btn', mode && 'v2-level__btn--on')}
          aria-label={`Level: ${level.name}`}
          aria-haspopup="menu"
          aria-expanded={mode !== null}
          aria-pressed={mode !== null}
          data-testid="v2-level-button"
          onClick={() => setMode((m) => (m ? null : 'menu'))}
        >
          <LevelIcon size={14} />
          <span className="v2-level__name">{level.name || 'Unnamed level'}</span>
          <ChevronDown size={14} strokeWidth={1.75} />
        </button>
      )}
      <span className="v2-level__count">
        {index + 1} of {plural(levels.length, 'level')}
      </span>
      <FloatMenu
        open={mode === 'menu'}
        onClose={() => setMode((m) => (m === 'menu' ? null : m))}
        label="Levels"
        entries={mainEntries}
        anchor={anchor}
        placement="above"
      />
      <FloatMenu
        open={mode === 'move'}
        onClose={() => setMode((m) => (m === 'move' ? null : m))}
        label="Move layer to level"
        entries={moveEntries}
        anchor={anchor}
        placement="above"
      />
      <LevelDeleteDialog levelId={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
