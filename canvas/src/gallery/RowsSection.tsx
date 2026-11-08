import { useState } from 'react';
import { Eraser } from 'lucide-react';
import {
  Caption,
  ColourRow,
  Fold,
  InputRow,
  SecondaryButton,
  Seg,
  SelectRow,
  SettingRow,
  SliderRow,
  Swatch,
  SwitchRow,
  Kbd,
} from '@dnd/ui';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

function RowsSection({ theme }: { theme: GalleryTheme }) {
  const [snap, setSnap] = useState(true);
  const [step, setStep] = useState('half');
  const [edge, setEdge] = useState('ink');
  const [opacity, setOpacity] = useState(100);
  const [tint, setTint] = useState<string | null>('#8c9a6c');
  return (
    <Section
      id="rows"
      title="Setting rows and captions"
      small="The panel and card vocabulary"
      theme={theme}
      rules="Label left in text-2, control right. A row is 28px minimum. Sections are separated by 12px and a caption. A slider row puts the value beside the label and the track on the next line, full width. Folds collapse to one line with their summary in mono."
    >
      <Specimens>
        <Item cap={'row 248 wide · min 28 tall · label 12 text-2 · control right\nswitch · segmented · select · input · slider · button with key · texture · fold · colour'}>
          <div className="flex flex-col gap-2">
            <Caption>Placement</Caption>
            <SwitchRow label="Snap to grid" checked={snap} onCheckedChange={setSnap} />
            <SettingRow label="Snap step">
              <Seg
                aria-label="Snap step"
                options={[{ value: 'one', label: '1' }, { value: 'half', label: '½' }, { value: 'quarter', label: '¼' }]}
                value={step}
                onValueChange={setStep}
              />
            </SettingRow>
            <SelectRow
              label="Edge band"
              value={edge}
              onValueChange={setEdge}
              options={[{ value: 'ink', label: 'Cave ink' }, { value: 'oak', label: 'Oak plank' }]}
            />
            <InputRow label="Width" defaultValue="5 ft" inputMode="decimal" />
            <SliderRow label="Opacity" value={opacity} format={(n) => `${n}%`} onValueChange={setOpacity} />
            <SettingRow label="Erase">
              <SecondaryButton icon={Eraser}>
                Hold <Kbd>Alt</Kbd>
              </SecondaryButton>
            </SettingRow>
            <SettingRow label="Texture">
              <span className="inline-flex items-center gap-1.5">
                <Swatch label="Texture" color="#cfc3ad" className="h-7 w-9" />
                <SecondaryButton>Change</SecondaryButton>
              </span>
            </SettingRow>
            <Fold title="Fill" summary="scale 1 · 0° · offset 0, 0">
              <InputRow label="Scale" defaultValue="1" inputMode="decimal" />
            </Fold>
            <ColourRow label="Tint" value={tint} onValueChange={setTint} />
          </div>
        </Item>
      </Specimens>
    </Section>
  );
}

export { RowsSection };
