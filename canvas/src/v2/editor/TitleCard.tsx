import { House } from 'lucide-react';
import { useStore } from '@/store/store';
import { openLevelMenuRef } from './layerActions';

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Top-left: the way back home, which map this is, and when it last reached storage. */
export function TitleCard({ onHome }: { onHome: () => void }) {
  const name = useStore((s) => {
    const entry = s.mapIndex.find((m) => m.id === s.activeMapId);
    return entry?.name || s.mapSettings.name || 'Untitled map';
  });
  // `updatedAt` moves on every save, autosave included, so it is the last-save time.
  const savedAt = useStore((s) => s.mapIndex.find((m) => m.id === s.activeMapId)?.updatedAt ?? null);
  // With more than one level, the level on show follows the name (board L4).
  const levelName = useStore((s) =>
    s.levels.length > 1 ? (s.levels.find((l) => l.id === s.ui.activeLevelId)?.name ?? null) : null,
  );

  return (
    <div className="v2-float v2-bar-card v2-title-card" data-testid="v2-title-card" data-chrome>
      <button
        type="button"
        className="v2-ib"
        data-testid="v2-home-chip"
        aria-label="Save and go home"
        data-tip="Home"
        data-tip-side="bottom"
        onClick={onHome}
      >
        <House size={15} strokeWidth={1.75} />
      </button>
      <span className="v2-vr" role="presentation" />
      <div className="v2-title-card__text">
        <div className="v2-title-card__name" title={levelName !== null ? `${name} · ${levelName}` : name}>
          {name}
          {levelName !== null && (
            <>
              {' '}
              <button
                type="button"
                className="v2-title-card__level"
                data-testid="v2-title-level"
                aria-label={`Level: ${levelName}`}
                data-tip="Levels"
                data-tip-side="bottom"
                onClick={() => openLevelMenuRef.current?.()}
              >
                · {levelName || 'Unnamed level'}
              </button>
            </>
          )}
        </div>
        <div className="v2-title-card__meta">{savedAt ? `saved ${clock(savedAt)}` : 'not saved yet'}</div>
      </div>
    </div>
  );
}
