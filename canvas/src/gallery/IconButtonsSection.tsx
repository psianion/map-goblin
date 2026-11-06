import {
  CircleHelp, Copy, Ellipsis, FlipHorizontal, GitCommitHorizontal, Hexagon, Lock, Mountain, Pentagon, Redo2, RotateCw,
  Spline, Square, Trash2, Undo2,
} from 'lucide-react';
import { IconKeyButton } from '@/editor/components';
import { FOCUS, HOVER, Item, Section, Specimens, type GalleryTheme } from './parts';

function IconButtonsSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section
      id="ibs"
      title="Icon button with key"
      small="Rail 36, dock 32, bar 28, row 26"
      theme={theme}
      rules="The key letter sits in the bottom right corner, mono, 8px at 28, 9px at 36, in text-3, 3px from the edges at 28 and 5px at 36. When a button has a key its icon moves 1.5px up and left (2px at 36) so the letter owns its corner. Hover is a panel-3 fill. Active is the 1.5px inset ring and no fill, so hover and active can show together. Focus is a 2px outline in the focus token, offset 1px. Disabled is 38% opacity. The icon never moves between states."
    >
      <Specimens>
        <Item cap={'rail 36 × 36 · radius 8 · icon 18 · key 9\nrest · hover · active · active+hover · focus · disabled'}>
          <div className="flex gap-2.5">
            <IconKeyButton size={36} icon={Mountain} label="Terrain, rest" shortcut="T" />
            <IconKeyButton size={36} icon={Mountain} label="Terrain, hover" shortcut="T" className={HOVER} />
            <IconKeyButton size={36} icon={Mountain} label="Terrain, active" shortcut="T" active />
            <IconKeyButton size={36} icon={Mountain} label="Terrain, active and hover" shortcut="T" active className={HOVER} />
            <IconKeyButton size={36} icon={Mountain} label="Terrain, focus" shortcut="T" className={FOCUS} />
            <IconKeyButton size={36} icon={Mountain} label="Terrain, disabled" shortcut="T" disabled />
          </div>
        </Item>
        <Item cap="dock 32 × 32 · radius 6 · icon 14 · key 8 · gap 4">
          <div className="flex gap-1">
            <IconKeyButton size={32} icon={Square} label="Rectangle" shortcut="R" />
            <IconKeyButton size={32} icon={Pentagon} label="Polygon" shortcut="P" active />
            <IconKeyButton size={32} icon={Hexagon} label="Regular polygon" shortcut="G" className={HOVER} />
            <IconKeyButton size={32} icon={Spline} label="Curve" shortcut="C" />
            <IconKeyButton size={32} icon={GitCommitHorizontal} label="Node mode" shortcut="N" disabled />
          </div>
        </Item>
        <Item cap="bar 28 × 28 · icon 16 · gap 4">
          <div className="flex gap-1">
            <IconKeyButton icon={Undo2} label="Undo" shortcut="Z" />
            <IconKeyButton icon={Redo2} label="Redo" shortcut="Y" disabled />
            <IconKeyButton icon={Ellipsis} label="Menu" />
            <IconKeyButton icon={CircleHelp} label="Keyboard shortcuts" shortcut="?" iconSize={14} />
          </div>
        </Item>
        <Item cap="row 26 × 26 · icon 14 · gap 2 · danger last">
          <div className="flex gap-[2px]">
            <IconKeyButton size={26} icon={FlipHorizontal} label="Flip" />
            <IconKeyButton size={26} icon={RotateCw} label="Rotate" />
            <IconKeyButton size={26} icon={Copy} label="Duplicate" />
            <IconKeyButton size={26} icon={Lock} label="Lock" active />
            <IconKeyButton size={26} icon={Trash2} label="Delete" danger />
          </div>
        </Item>
      </Specimens>
    </Section>
  );
}

export { IconButtonsSection };
