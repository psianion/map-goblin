import {
  BrickWall, Copy, DoorOpen, EyeOff, FlipHorizontal, FlipVertical, GitCommitHorizontal, Lock, Mountain, RotateCw,
  SquareDashed, Trash2,
} from 'lucide-react';
import { ActionRow, Chip, FloatBox, FlyoutRow, IconKeyButton, PanelHeader } from '@dnd/ui';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

// The slot is 272 inside its hairline.
const SLOT = 'w-[274px]';

function HeadersSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section id="heads" title="Panel header, action row, flyout row" theme={theme}>
      <Specimens>
        <Item cap="panel header 40 · pad 12 left 8 right · crumb 11/12 · switcher 26 buttons gap 2">
          <FloatBox className={`${SLOT} p-0`}>
            <PanelHeader path={['Design']} title="Floor">
              <IconKeyButton size={26} icon={SquareDashed} label="Floor" shortcut="F" active />
              <IconKeyButton size={26} icon={BrickWall} label="Wall" shortcut="W" />
              <IconKeyButton size={26} icon={DoorOpen} label="Door" shortcut="D" />
              <IconKeyButton size={26} icon={Mountain} label="Elevation" shortcut="E" />
            </PanelHeader>
          </FloatBox>
        </Item>
        <Item cap="card header + action row · row pad 6 8 · 26 buttons gap 2 · delete pushed right">
          <FloatBox className={`${SLOT} p-0`}>
            <PanelHeader path={['Selection']} title="Door">
              <Chip className="text-[10px]">Walls</Chip>
            </PanelHeader>
            <ActionRow aria-label="Door actions">
              <IconKeyButton size={26} icon={GitCommitHorizontal} label="Node mode" shortcut="N" />
              <IconKeyButton size={26} icon={FlipHorizontal} label="Flip horizontal" />
              <IconKeyButton size={26} icon={FlipVertical} label="Flip vertical" />
              <IconKeyButton size={26} icon={RotateCw} label="Rotate" />
              <IconKeyButton size={26} icon={Copy} label="Duplicate" />
              <IconKeyButton size={26} icon={Lock} label="Lock" />
              <IconKeyButton size={26} icon={EyeOff} label="Hide" />
              <IconKeyButton size={26} icon={Trash2} label="Delete" danger />
            </ActionRow>
          </FloatBox>
        </Item>
        <Item cap="flyout row 44 · icon 32 · gap 12 · name 13/500 · description 11 text-3 · one line, ellipsis">
          <FloatBox className={`${SLOT} p-1.5`}>
            <FlyoutRow icon={SquareDashed} shortcut="F" name="Floor" description="Rectangle, polygon, regular polygon" active />
            <FlyoutRow icon={BrickWall} shortcut="W" name="Wall" description="Solid, window, open" />
          </FloatBox>
        </Item>
      </Specimens>
    </Section>
  );
}

export { HeadersSection };
