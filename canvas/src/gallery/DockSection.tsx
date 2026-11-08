import { useState } from 'react';
import { ChevronDown, Hexagon, Pentagon, Plus, Square } from 'lucide-react';
import { AddTile, DockColumn, FloatBox, IconKeyButton, LevelList, Stepper, Tile } from '@dnd/ui';
import { Section, type GalleryTheme } from './parts';

const LEVELS = [
  { id: '3', label: 'L3 Attic' },
  { id: '2', label: 'L2 Cellars' },
  { id: '1', label: 'L1 Ground' },
];
const chevron = <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5" />;

function DockSection({ theme }: { theme: GalleryTheme }) {
  const [level, setLevel] = useState('2');
  const [shape, setShape] = useState('polygon');
  const [sides, setSides] = useState(6);
  return (
    <Section
      id="dock"
      title="Dock columns"
      theme={theme}
      rules="A column is a caption row then a strip, 8px padding, 10px sides, hairline between columns. The caption's right end holds the column's one control (a dropdown, a plus). Tiles are 56 wide with 6px between. The dock is 112 tall and never changes height between tools."
    >
      <FloatBox className="inline-flex overflow-hidden p-0">
        <DockColumn title="Level" control={chevron}>
          <LevelList levels={LEVELS} value={level} onValueChange={setLevel} />
        </DockColumn>
        <DockColumn title="Layers" control={<Plus aria-hidden strokeWidth={1.75} className="size-3.5" />}>
          <Tile name="Walls" locked />
          <Tile name="Stone floor" active />
          <Tile name="Water" />
        </DockColumn>
        <DockColumn title="Shape">
          <div className="flex items-center gap-1">
            <IconKeyButton size={32} icon={Square} label="Rectangle" shortcut="R" active={shape === 'rect'} onClick={() => setShape('rect')} />
            <IconKeyButton size={32} icon={Pentagon} label="Polygon" shortcut="P" active={shape === 'polygon'} onClick={() => setShape('polygon')} />
            <IconKeyButton size={32} icon={Hexagon} label="Regular polygon" shortcut="G" active={shape === 'regular'} onClick={() => setShape('regular')} />
            <Stepper label="Sides" value={sides} min={3} max={12} onValueChange={setSides} />
          </div>
        </DockColumn>
        <DockColumn title="Look" control={<>Fieldstone Keep {chevron}</>}>
          <Tile name="Colour" color="#d9cfbd" />
          <Tile name="Flagstone" active color="#b9ad96" />
          <AddTile name="From library" />
        </DockColumn>
      </FloatBox>
      <div className="mt-2 font-mono text-[10px] text-text-3">
        dock 112 tall · column pad 8 10 · caption 10 caps with its one control at the right · hairline between columns
      </div>
    </Section>
  );
}

export { DockSection };
