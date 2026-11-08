import { useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { useStore } from '@/store/store';
import { layerObjectCount, layersOnLevel } from '@dnd/core/src/store/layerCommands';
import { PrimaryButton, Seg } from '@/editor/components';
import { deleteLevel } from '@/editor/models/layerActions';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Actions, DialogHead, Field, Hint, SelectField } from './parts';

/**
 * Delete level: a level never ends up empty-handed, so the dialog asks where its layers go,
 * another level or out with it. One undo step either way.
 */
export function LevelDeleteDialog({ levelId, onClose }: { levelId: string | null; onClose: () => void }) {
  const level = useStore((s) => (levelId ? s.levels.find((l) => l.id === levelId) : undefined));
  if (!levelId || !level) return null;
  return <DeleteForm key={levelId} levelId={levelId} onClose={onClose} />;
}

function DeleteForm({ levelId, onClose }: { levelId: string; onClose: () => void }) {
  const levels = useStore((s) => s.levels);
  const layers = useStore((s) => s.layers);
  const level = levels.find((l) => l.id === levelId)!;
  const others = levels.filter((l) => l.id !== levelId);
  const onLevel = layersOnLevel({ layers }, levelId);
  const objects = onLevel.reduce((n, l) => n + layerObjectCount(l), 0);
  const [mode, setMode] = useState<'move' | 'delete'>('move');
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '');
  useEscapeToClose(true, onClose);

  const confirm = () => {
    if (deleteLevel(levelId, mode === 'move' ? moveTo : null)) onClose();
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-v2-home=""
        data-testid="v2-level-delete-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          confirm();
        }}
      >
        <DialogHead title={`Delete ${level.name || 'level'}?`} onClose={onClose} />
        <p className="m-0 text-[12px] text-text-2">
          {level.name || 'This level'} holds {plural(onLevel.length, 'layer')} with {plural(objects, 'object')}. A level never ends
          up empty, so choose where they go.
        </p>
        <Field label="Its layers">
          <Seg
            aria-label="Its layers"
            value={mode}
            onValueChange={(v) => setMode(v as 'move' | 'delete')}
            options={[
              { value: 'move', label: 'Move to a level', testId: 'v2-level-delete-move' },
              { value: 'delete', label: 'Delete with it', testId: 'v2-level-delete-all' },
            ]}
          />
        </Field>
        {mode === 'move' && (
          <SelectField
            label="Move to"
            value={moveTo}
            testId="v2-level-delete-target"
            options={others.map((l) => ({ value: l.id, label: l.name || 'Unnamed level' }))}
            onValueChange={setMoveTo}
          />
        )}
        <Hint>Ctrl Z brings the level back with its layers.</Hint>
        <Actions>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <PrimaryButton data-testid="v2-level-delete-confirm" onClick={confirm}>
            Delete level
          </PrimaryButton>
        </Actions>
      </DialogContent>
    </Dialog>
  );
}
