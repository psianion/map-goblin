import { House } from 'lucide-react';
import { FloatBox, IconKeyButton } from '@/editor/components';
import { useStore } from '@/store/store';
import { Button } from '@/ui/button';
import { LevelMenu } from './LevelMenu';
import { levelLabel } from './model';

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Top left, 44 tall: home first, the map's name, the level on show (its menu), when it last saved. */
export function TitleCard({ onHome }: { onHome: () => void }) {
  const name = useStore((s) => {
    const entry = s.mapIndex.find((m) => m.id === s.activeMapId);
    return entry?.name || s.mapSettings.name || 'Untitled map';
  });
  // `updatedAt` moves on every save, autosave included, so it is the last-save time.
  const savedAt = useStore((s) => s.mapIndex.find((m) => m.id === s.activeMapId)?.updatedAt ?? null);
  const level = useStore((s) => {
    const i = s.levels.findIndex((l) => l.id === s.ui.activeLevelId);
    return i < 0 ? null : levelLabel(i, s.levels.length, s.levels[i].name);
  });
  return (
    <FloatBox
      className="absolute top-3 left-[68px] flex h-11 items-center gap-2 py-0 pr-3 pl-1.5"
      data-testid="shell-title-card"
      data-chrome
    >
      <IconKeyButton icon={House} label="Save and go home" data-tip="Home" data-tip-side="bottom" onClick={onHome} />
      <span className="max-w-[320px] truncate text-[13px] font-medium text-text">{name}</span>
      {level && (
        <LevelMenu
          trigger={
            <Button
              variant="ghost"
              aria-label={`Level: ${level}`}
              data-testid="shell-title-level"
              data-tip="Levels"
              data-tip-side="bottom"
              className="h-auto rounded-key border border-line px-1.5 py-0.5 font-mono text-[10px] font-normal text-text-2 hover:bg-panel-2"
            >
              {level}
            </Button>
          }
        />
      )}
      <span className="font-mono text-[10px] text-text-3">{savedAt ? `saved ${clock(savedAt)}` : 'not saved yet'}</span>
    </FloatBox>
  );
}
