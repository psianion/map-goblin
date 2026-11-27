import { IconKeyButton } from '@dnd/ui';
import { Redo2, Undo2 } from '@dnd/ui/icons';
import { useSessionStore } from '../../session/store';
import { historyStep, stepName } from '../hotkeys';

/** The DM's Undo and Redo, each naming its step, and off while the server says there is none. */
export function HistoryButtons() {
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const { undo, redo } = useSessionStore((s) => s.history);
  if (!isDm) return null;
  const undoTip = undo ? `Undo ${stepName(undo)}` : 'Nothing to undo';
  const redoTip = redo ? `Redo ${stepName(redo)}` : 'Nothing to redo';
  return (
    <>
      <IconKeyButton icon={Undo2} label={undoTip} title={undoTip} disabled={!undo} data-testid="history-undo" onClick={() => historyStep('undo')} />
      <IconKeyButton icon={Redo2} label={redoTip} title={redoTip} disabled={!redo} data-testid="history-redo" onClick={() => historyStep('redo')} />
    </>
  );
}
