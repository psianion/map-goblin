import { Eraser } from 'lucide-react';
import { Chip, PrimaryButton, SecondaryButton } from '@/editor/components';
import { Kbd } from '@/ui/kbd';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

function ButtonsSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section id="btns" title="Buttons, chips, keys" theme={theme}>
      <Specimens>
        <Item cap={'primary 28 · pad 14 · 12/500 · ink\nrest · hover · disabled'}>
          <div className="flex items-center gap-2">
            <PrimaryButton>Publish</PrimaryButton>
            <PrimaryButton className="bg-ink-hover">Publish</PrimaryButton>
            <PrimaryButton disabled>Publish</PrimaryButton>
          </div>
        </Item>
        <Item cap={'secondary 24 · pad 10 · 11 · hairline · icon 14 gap 6\nrest · hover · active · disabled · with key'}>
          <div className="flex items-center gap-2">
            <SecondaryButton>Reset</SecondaryButton>
            <SecondaryButton className="bg-panel-2 text-text">Reset</SecondaryButton>
            <SecondaryButton icon={Eraser} active>
              Erase
            </SecondaryButton>
            <SecondaryButton disabled>Reset</SecondaryButton>
            <SecondaryButton>
              Hold <Kbd>Alt</Kbd>
            </SecondaryButton>
          </div>
        </Item>
        <Item cap={'chip 22 tall · pad 10 · 11 · pill · gap 4\nrest · on'}>
          <div className="flex items-center gap-1">
            <Chip>All</Chip>
            <Chip defaultPressed>Props</Chip>
            <Chip defaultPressed>Lights</Chip>
            <Chip>Zones</Chip>
          </div>
        </Item>
        <Item cap="keycap 18 tall · min 18 wide · pad 5 · 10 mono · radius 4 · panel-2">
          <div className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd>
            <Kbd>Backspace</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>N</Kbd>
            <Kbd>0</Kbd>
          </div>
        </Item>
      </Specimens>
    </Section>
  );
}

export { ButtonsSection };
