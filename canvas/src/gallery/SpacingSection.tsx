import { cn } from '@/lib/utils';
import { Item, Section, Specimens, type GalleryTheme } from './parts';

const SCALE = [
  ['4', 'h-1'],
  ['6', 'h-1.5'],
  ['8', 'h-2'],
  ['10', 'h-2.5'],
  ['12', 'h-3'],
  ['16', 'h-4'],
];
const RADII = [
  ['4', 'rounded-key'],
  ['6', 'rounded-control'],
  ['8', 'rounded-float'],
  ['pill', 'rounded-pill'],
];
const SHADOWS = [
  ['shadow-sm', 'shadow-sm'],
  ['e-shadow', 'shadow-e'],
  ['shadow', 'shadow'],
];

const card = 'flex border border-line bg-panel font-mono text-[10px] text-text-3';

function SpacingSection({ theme }: { theme: GalleryTheme }) {
  return (
    <Section
      id="space"
      title="Spacing, shape, elevation"
      theme={theme}
      rules="12px from every screen edge and 12px between floats. 8px between a float's edge and its content, 12px on the left of text rows. 6px between tiles, 2px between icon buttons in a row, 10px between rail buttons. Radius 8 for floats, 6 for controls and tiles, 4 for keycaps and level rows. One shadow for floats, none on controls."
    >
      <Specimens>
        <Item cap="spacing scale, px">
          <div className="flex items-end gap-3.5">
            {SCALE.map(([n, h]) => (
              <div key={n} className="flex flex-col items-center gap-1.5 font-mono text-[10px] text-text-3">
                <i className={cn('block w-[18px] bg-ink opacity-80', h)} />
                {n}
              </div>
            ))}
          </div>
        </Item>
        <Item cap="radius: kbd · controls, tiles · floats · chips, switch">
          <div className="flex gap-5">
            {RADII.map(([n, r]) => (
              <div key={n} className={cn(card, 'h-11 w-14 items-end justify-center pb-1', r)}>
                {n}
              </div>
            ))}
          </div>
        </Item>
        <Item cap="elevation: chips · floats · sheets">
          <div className="flex gap-5">
            {SHADOWS.map(([n, s]) => (
              <div key={n} className={cn(card, 'h-14 w-[120px] items-end rounded-float px-2 py-1.5', s)}>
                {n}
              </div>
            ))}
          </div>
        </Item>
      </Specimens>
    </Section>
  );
}

export { SpacingSection };
