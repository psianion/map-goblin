import { useState } from 'react';
import { Seg, SliderRow, Stepper, Swatch } from '@/editor/components';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Slider } from '@/ui/slider';
import { Switch } from '@/ui/switch';
import { FOCUS, Item, Section, Specimens, type GalleryTheme } from './parts';

const EDGES = [
  { value: 'ink', label: 'Cave ink' },
  { value: 'oak', label: 'Oak plank' },
];

function ControlsSection({ theme }: { theme: GalleryTheme }) {
  const [mode, setMode] = useState('draw');
  const [door, setDoor] = useState('open');
  const [size, setSize] = useState(16);
  const [sides, setSides] = useState(6);
  const [offset, setOffset] = useState(2);
  return (
    <Section
      id="ctls"
      title="Controls"
      small="24px tall inside panels and cards"
      theme={theme}
      rules="A control is 24px tall in a panel. Segmented controls use panel-3 for the chosen cell, no ring. Switch knob is always white; the track is line-strong off and ink on. Slider thumb is 12px with a 1.5px ink ring, the track 2px. Values sit right-aligned in mono beside the label and the slider drops to a second line."
    >
      <Specimens>
        <Item cap="switch 28 × 16 · knob 12 · off · on">
          <div className="flex items-center gap-3">
            <Switch aria-label="Off" />
            <Switch aria-label="On" defaultChecked />
          </div>
        </Item>
        <Item cap="segmented 24 · cell pad 10 · 11 · chosen = panel-3">
          <div className="flex items-center gap-3">
            <Seg aria-label="Mode" options={[{ value: 'draw', label: 'Draw' }, { value: 'carve', label: 'Carve out' }]} value={mode} onValueChange={setMode} />
            <Seg
              aria-label="Door"
              options={[{ value: 'closed', label: 'Closed' }, { value: 'open', label: 'Open' }, { value: 'locked', label: 'Locked' }]}
              value={door}
              onValueChange={setDoor}
            />
          </div>
        </Item>
        <Item cap={'slider · track 2 line-strong · thumb 12 ring 1.5 ink\nvalue mono right, track on its own line'}>
          <SliderRow className="w-[200px]" label="Size" value={size} max={40} format={(n) => `${n} sq`} onValueChange={setSize} />
        </Item>
        <Item cap="range · two thumbs · span in ink">
          <Slider className="w-[200px]" aria-label="Rotation range" defaultValue={[30, 70]} />
        </Item>
        <Item cap="stepper 24 · cells 22 · value mono 11">
          <div className="flex items-center gap-3">
            <Stepper label="Sides" value={sides} min={3} max={12} onValueChange={setSides} />
            <Stepper label="Offset" value={offset} format={(n) => (n > 0 ? `+${n}` : `${n}`)} onValueChange={setOffset} />
          </div>
        </Item>
        <Item cap="select 24 · pad 8 6 · chevron 14">
          <div className="flex items-center gap-3">
            {['ink', 'oak'].map((v) => (
              <Select key={v} items={EDGES} defaultValue={v}>
                <SelectTrigger aria-label="Edge band">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDGES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          </div>
        </Item>
        <Item cap="input 24 · mono for numbers · focus = 2px outline">
          <div className="flex items-center gap-3">
            <Input aria-label="Width" inputMode="decimal" defaultValue="5 ft" className="w-[72px]" />
            <Input aria-label="Angle" inputMode="decimal" defaultValue="120°" className={`w-[72px] border-line-strong ${FOCUS}`} />
            <Input aria-label="Search packs" placeholder="Search packs" className="w-[96px]" />
          </div>
        </Item>
        <Item cap="colour swatch 24 · radius 6 · empty = none">
          <div className="flex items-center gap-3">
            <Swatch label="Sand" color="#cfc3ad" />
            <Swatch label="Moss" color="#8c9a6c" />
            <Swatch label="None" color={null} />
            <Swatch label="Lamp" color="#ffdd88" />
          </div>
        </Item>
      </Specimens>
    </Section>
  );
}

export { ControlsSection };
