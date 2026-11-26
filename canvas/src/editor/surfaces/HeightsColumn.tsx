import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DockColumn, Tile } from '@dnd/ui';
import { useStore } from '@/store/store';
import { useShell } from '@/editor/shell/shellStore';
import { levelDungeons } from '@/editor/models/roomModel';
import { heightLabel, heightThumbKey, levelHeights, nextHeightPin } from '@/editor/models/heightModel';
import { Thumb } from './LayersColumn';

/**
 * The dock's Heights column: one card per height in use on the level being edited, highest
 * first with 0 for the ground among them, each a picture of where that height is. Hovering a card
 * highlights its height on the map; a click keeps the highlight on, and a second click, Esc
 * or another card changes or clears it. A view only: the selection, the tool and the map stay
 * as they are. A flat level has no column.
 */
export function HeightsColumn() {
  const layers = useStore(useShallow((s) => s.layers));
  const levels = useStore(useShallow((s) => s.levels));
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  const pin = useShell((s) => s.heightPin);
  const heights = levelHeights(levelDungeons(layers, levels, activeLevelId));
  const shown = heights.length > 0;

  // The highlight belongs to the level on show: it goes with a level change, and with the column.
  useEffect(
    () => () => {
      useShell.getState().setHeightHover(null);
      useShell.getState().setHeightPin(null);
    },
    [activeLevelId, shown],
  );

  // Capture, so Esc lets a kept highlight go before the canvas shortcuts see it.
  useEffect(() => {
    if (pin === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      useShell.getState().setHeightPin(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pin]);

  if (!shown) return null;
  return (
    <DockColumn title="Heights" data-column="heights">
      <div className="flex max-w-[436px] gap-1.5 overflow-x-auto" role="group" aria-label="Heights" data-keys="canvas">
        {heights.map((h) => {
          const label = heightLabel(h);
          const what = h === 0 ? 'the ground' : `height ${label}`;
          return (
            <Tile
              key={h}
              name={label}
              active={pin === h}
              aria-label={`Show ${what} on the map`}
              data-tip={pin === h ? `Showing ${what}: click to stop` : `Show ${what}: click to keep it shown`}
              data-testid="shell-height-card"
              onPointerEnter={() => useShell.getState().setHeightHover(h)}
              onPointerLeave={() => useShell.getState().setHeightHover(null)}
              onClick={() => useShell.getState().setHeightPin(nextHeightPin(useShell.getState().heightPin, h))}
            >
              <Thumb thumbKey={heightThumbKey(activeLevelId, h)} fallback={null} />
            </Tile>
          );
        })}
      </div>
    </DockColumn>
  );
}
