import { useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useStore } from '@/store/store';
import { RenameLevelCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { addLevelWithLayer } from '@/v2/editor/roomActions';
import { layerOnLevel } from '@/v2/editor/roomModel';
import { moveLayerToLevel, reorderLevel } from '@/v2/editor/layerActions';
import { LevelDeleteDialog } from '@/v2/editor/LevelDeleteDialog';
import { useShell } from '@/editor/shell/shellStore';
import { RenameDialog } from './RenameDialog';
import { levelLabel } from './model';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The levels menu, on the dock's Level column and the title card's level chip: switch level
 * (Page Up and Page Down do too), add one with a first layer, rename or move the one on show,
 * move the active layer to another, open the level's settings, or delete it.
 */
export function LevelMenu({ trigger, align = 'start' }: { trigger: ReactElement; align?: 'start' | 'end' }) {
  const levels = useStore(useShallow((s) => s.levels));
  const layers = useStore((s) => s.layers);
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const activeLayer = useStore((s) => s.layers.find((l) => l.id === s.ui.activeLayerId));
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (levels.length === 0) return trigger;
  const index = Math.max(0, levels.findIndex((l) => l.id === activeLevelId));
  const level = levels[index];
  const layerCount = (id: string) => layers.filter((l) => l.type !== 'background' && layerOnLevel(l, levels, id)).length;
  const keyFor = (i: number) => (i === index - 1 ? 'PgUp' : i === index + 1 ? 'PgDn' : '');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align={align} className="w-[232px]" data-testid="shell-level-menu">
          <DropdownMenuRadioGroup
            value={level.id}
            onValueChange={(id) => {
              const s = useStore.getState();
              s.setActiveLevelId(id as string);
              s.setSelectedIds([]);
            }}
          >
            {levels.map((l, i) => (
              <DropdownMenuRadioItem key={l.id} value={l.id}>
                {levelLabel(i, levels.length, l.name)}
                <DropdownMenuShortcut>{keyFor(i) || plural(layerCount(l.id), 'layer')}</DropdownMenuShortcut>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => addLevelWithLayer()}>New level</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>Rename level…</DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onClick={() => reorderLevel(index, index - 1)}>
            Move level up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index >= levels.length - 1} onClick={() => reorderLevel(index, index + 1)}>
            Move level down
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={levels.length < 2 || !activeLayer || activeLayer.type === 'background'}>
              Move layer to level
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {levels
                .map((l, i) => ({ l, i }))
                .filter(({ l }) => l.id !== level.id)
                .map(({ l, i }) => (
                  <DropdownMenuItem key={l.id} onClick={() => activeLayer && moveLayerToLevel(activeLayer.id, l.id)}>
                    {levelLabel(i, levels.length, l.name)}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => useStore.getState().setSelectedIds([level.id])}>Level settings</DropdownMenuItem>
          <DropdownMenuItem onClick={() => useShell.getState().openSheet('layers')}>Levels and layers…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={levels.length < 2} onClick={() => setDeleting(level.id)} className="text-danger">
            Delete level…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameDialog
        open={renaming}
        title="Rename level"
        label="Name"
        value={level.name}
        onClose={() => setRenaming(false)}
        onRename={(name) => undoManager.execute(new RenameLevelCommand(level.id, name))}
      />
      <LevelDeleteDialog levelId={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}
