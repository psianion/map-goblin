import { Box, CircleHelp, Ellipsis, Hand, House, Mountain, MousePointer2, PencilRuler, Redo2, Ruler, SunMoon, Type, Undo2 } from 'lucide-react';
import { FloatBox, IconKeyButton, KeyHint, PrimaryButton, StatusChip } from '@/editor/components';
import { Kbd } from '@/ui/kbd';
import { Separator } from '@/ui/separator';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

const bar = 'inline-flex h-11 items-center gap-2 px-2 py-0';

function BarsSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section id="bars" title="Bars, rail, status" theme={theme}>
      <Specimens>
        <Item cap="title card 44 · pad 8 · gap 8 · home 28 · level chip mono 10 · saved mono 10 text-3">
          <FloatBox className={bar}>
            <IconKeyButton icon={House} label="Home" />
            <span className="text-[13px] font-medium">Warren of the Pale Moth</span>
            <span className="rounded-key border border-line px-1.5 py-0.5 font-mono text-[10px] text-text-2">L2 Cellars</span>
            <span className="font-mono text-[10px] text-text-3">saved 14:32</span>
          </FloatBox>
        </Item>
        <Item cap="top actions 44 · gap 4 · primary last with 4 extra">
          <FloatBox className={`${bar} gap-1`}>
            <IconKeyButton icon={Undo2} label="Undo" shortcut="Z" />
            <IconKeyButton icon={Redo2} label="Redo" shortcut="Y" disabled />
            <IconKeyButton icon={Ellipsis} label="Menu" />
            <PrimaryButton className="ml-1">Publish</PrimaryButton>
          </FloatBox>
        </Item>
        <Item cap="rail 56 wide · pad 12 top · 36 buttons · gap 10 · divider 24 wide with 6 above and below">
          <FloatBox className="flex h-[420px] w-14 flex-col items-center gap-2.5 rounded-none px-0 py-3">
            <IconKeyButton size={36} icon={MousePointer2} label="Select" shortcut="V" active />
            <IconKeyButton size={36} icon={Hand} label="Pan" shortcut="H" />
            <IconKeyButton size={36} icon={Ruler} label="Measure" shortcut="M" />
            <Separator className="my-1.5 w-6" />
            <IconKeyButton size={36} icon={PencilRuler} label="Design" shortcut="D" active />
            <IconKeyButton size={36} icon={Mountain} label="Terrain" shortcut="T" />
            <IconKeyButton size={36} icon={Box} label="Objects" shortcut="O" />
            <IconKeyButton size={36} icon={SunMoon} label="Environment" shortcut="E" />
            <IconKeyButton size={36} icon={Type} label="Text" shortcut="X" />
          </FloatBox>
        </Item>
      </Specimens>
      <div className="mt-5 flex h-7 w-full items-center gap-4 rounded-t-none rounded-b-float border border-line bg-panel pr-2 pl-3 shadow-e">
        <StatusChip>Grid 5 ft</StatusChip>
        <StatusChip>Snap ½</StatusChip>
        <StatusChip>Lit · off</StatusChip>
        <StatusChip className="gap-1.5 text-text-2">
          Click points · <KeyHint keys="Enter">close</KeyHint> · <KeyHint keys="Backspace">last point</KeyHint>
        </StatusChip>
        <span className="flex-1" />
        <StatusChip>
          Fit <Kbd>0</Kbd> · 100%
        </StatusChip>
        <IconKeyButton icon={CircleHelp} label="Keyboard shortcuts" shortcut="?" iconSize={14} />
      </div>
      <div className="mt-2 font-mono text-[10px] text-text-3">status 28 · mono 11 · gap 16 · hint in text-2 with keycaps · help last</div>
    </Section>
  );
}

export { BarsSection };
