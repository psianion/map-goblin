import { Ellipsis, Redo2, Undo2 } from 'lucide-react';
import { FloatBox, IconKeyButton, PrimaryButton } from '@/editor/components';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useStore } from '@/store/store';
import { handleShortcut } from '@/shortcuts/defaultShortcuts';
import { keyCaption } from '@/shortcuts/formatCombo';
import { zoomToFitRef } from '@/editor/zoomToFitRef';
import type { EditorChromeActions } from '@/editor/EditorHost';
import { useTheme } from '@/theme/theme';
import { FOCUS_MODES, setLitPreview, useLitPreview, type FocusMode } from '@/editor/viewPrefs';
import { useShell } from '@/editor/shell/shellStore';

const FOCUS_LABEL: Record<FocusMode, string> = { auto: 'Auto', manual: 'Manual', fullscreen: 'Fullscreen' };

type RoomLabels = 'off' | 'numbers' | 'both';
/** What the rooms overlay writes on each room: a view, so it lives here, not on the Rooms tools. */
const ROOM_LABELS: { value: RoomLabels; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'numbers', label: 'Numbers' },
  { value: 'both', label: 'Numbers and names' },
];

/** Top right, 44 tall: Undo, Redo, everything else behind "…", and Publish last. */
export function TopActions({ actions, onOpenSettings }: { actions: EditorChromeActions; onOpenSettings: () => void }) {
  const canUndo = useStore((s) => s.ui.canUndo);
  const canRedo = useStore((s) => s.ui.canRedo);
  const focusMode = useStore((s) => s.ui.focusMode);
  const seeUnder = useStore((s) => s.ui.seeUnderOverhead);
  const gridShown = useStore((s) => s.grid.visible);
  const labelsHidden = useStore((s) => s.ui.labelsHidden);
  const outlines = useStore((s) => s.ui.roomOverlayVisible);
  const roomLabels = useStore((s) => s.ui.roomLabels);
  const lit = useLitPreview();
  const [theme, toggleTheme] = useTheme();
  const openSheet = useShell((s) => s.openSheet);
  return (
    <FloatBox
      className="absolute top-3 right-3 flex h-11 items-center gap-1 px-2 py-0"
      data-testid="shell-top-actions"
      data-chrome
      data-keys="canvas"
    >
      <IconKeyButton
        icon={Undo2}
        label="Undo"
        shortcut="Z"
        disabled={!canUndo}
        data-tip="Undo"
        data-tip-key={keyCaption('edit.undo')}
        data-tip-side="bottom"
        onClick={() => handleShortcut('ctrl+z')}
      />
      <IconKeyButton
        icon={Redo2}
        label="Redo"
        shortcut="Y"
        disabled={!canRedo}
        data-tip="Redo"
        data-tip-key={keyCaption('edit.redo')}
        data-tip-side="bottom"
        onClick={() => handleShortcut('ctrl+y')}
      />
      <DropdownMenu>
        <DropdownMenuTrigger render={<IconKeyButton icon={Ellipsis} label="More" data-testid="shell-more" />} />
        <DropdownMenuContent align="end" className="w-[232px]">
          <DropdownMenuItem onClick={onOpenSettings}>Map settings…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={actions.openExport}>
            Export…<DropdownMenuShortcut>{keyCaption('file.export')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openSheet('packs')}>Packs…</DropdownMenuItem>
          <DropdownMenuItem onClick={actions.importImage}>
            Import image…<DropdownMenuShortcut>{keyCaption('file.import')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={actions.importTrace}>Import as trace…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => zoomToFitRef.current?.()}>
            Fit to content<DropdownMenuShortcut>{keyCaption('view.fitToContent')}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>View</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={lit} onCheckedChange={(v) => setLitPreview(v)}>
              Lit preview<DropdownMenuShortcut>{keyCaption('view.litPreview')}</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={gridShown} onCheckedChange={(v) => useStore.getState().setGridVisible(v)}>
              Show grid
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={seeUnder} onCheckedChange={(v) => useStore.getState().setSeeUnderOverhead(v)}>
              See under overhead
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={labelsHidden} onCheckedChange={(v) => useStore.getState().setLabelsHidden(v)}>
              Hide labels
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={outlines} onCheckedChange={(v) => useStore.getState().setRoomOverlayVisible(v)}>
              Room outlines
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Room labels</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={roomLabels} onValueChange={(v) => useStore.getState().setRoomLabels(v as RoomLabels)}>
              {ROOM_LABELS.map((m) => (
                <DropdownMenuRadioItem key={m.value} value={m.value}>
                  {m.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Focus</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={focusMode} onValueChange={(v) => useStore.getState().setFocusMode(v as FocusMode)}>
              {FOCUS_MODES.map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  {FOCUS_LABEL[m]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleTheme}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSheet('shortcuts')}>
            Keyboard shortcuts<DropdownMenuShortcut>{keyCaption('view.shortcuts')}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PrimaryButton className="ml-1" data-testid="shell-publish" onClick={actions.openPublish}>
        Publish
      </PrimaryButton>
    </FloatBox>
  );
}
