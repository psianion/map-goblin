import { useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '@/store/store';
import { layerObjectCount, layersOnLevel } from '@dnd/core/src/store/layerCommands';
import { cn } from '@/lib/utils';
import { deleteLevel } from './layerActions';
import './rooms.css';
import './layers-sheet.css';

/**
 * Delete level (board L4): a level never ends up empty-handed, so the dialog asks where
 * its layers go, another level or out with it. One undo step either way.
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

  const confirm = () => {
    if (deleteLevel(levelId, mode === 'move' ? moveTo : null)) onClose();
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogBackdrop className="v2-backdrop" />
        <DialogContent className="v2-modal max-w-[380px] p-0">
          <div
            data-v2-home=""
            data-testid="v2-level-delete-dialog"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement) return;
              e.preventDefault();
              confirm();
            }}
          >
            <div className="v2-modal__head">
              <DialogTitle className="v2-modal__title">Delete {level.name || 'level'}?</DialogTitle>
              <button type="button" className="v2-x" aria-label="Close" onClick={onClose}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
            <div className="v2-modal__body">
              <p className="v2-hint">
                {level.name || 'This level'} holds {plural(onLevel.length, 'layer')} with {plural(objects, 'object')}. A level never
                ends up empty, so choose where they go.
              </p>
              <div className="v2-split__radios" role="radiogroup" aria-label="Its layers">
                <label className={cn('v2-split__radio', 'v2-ldel__opt')}>
                  <input
                    type="radio"
                    name="v2-level-delete"
                    checked={mode === 'move'}
                    data-testid="v2-level-delete-move"
                    onChange={() => setMode('move')}
                  />
                  Move its layers to
                  <select
                    className="v2-select v2-ldel__select"
                    aria-label="Level"
                    value={moveTo}
                    data-testid="v2-level-delete-target"
                    onChange={(e) => {
                      setMoveTo(e.target.value);
                      setMode('move');
                    }}
                  >
                    {others.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name || 'Unnamed level'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="v2-split__radio">
                  <input
                    type="radio"
                    name="v2-level-delete"
                    checked={mode === 'delete'}
                    data-testid="v2-level-delete-all"
                    onChange={() => setMode('delete')}
                  />
                  Delete the layers and their objects
                </label>
              </div>
              <p className="v2-hint">Ctrl Z brings the level back with its layers.</p>
            </div>
            <div className="v2-modal__foot">
              <button type="button" className="v2-btn v2-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="v2-btn v2-btn--primary" data-testid="v2-level-delete-confirm" onClick={confirm}>
                Delete level
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
