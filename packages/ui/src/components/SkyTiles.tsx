import { cn } from '../lib/utils';
import { Tile } from './Tile';

/** The four times of day the sky is drawn at. */
export type SkyTime = 'dawn' | 'day' | 'dusk' | 'night';
/** How much sky reaches the ground. */
export type SkyPlace = 'outdoor' | 'indoor' | 'underground';

/** The small landscape every tile picture is cut from. */
const LANDSCAPE = 'linear-gradient(115deg, #b7c38c 0 48%, #8fb9cf 48% 62%, #cfc6b2 62%)';

/**
 * The landscape strip, multiplied by one colour (none for the plain strip), with a mark on top,
 * and the whole picture, mark and all, multiplied by `tint` when the time has one.
 */
function Strip({ multiply, tint, faded, children }: { multiply?: string; tint?: string; faded?: boolean; children?: React.ReactNode }) {
  return (
    <span
      aria-hidden
      data-slot="sky-picture"
      className={cn('absolute inset-x-0 top-0 isolate block h-10 overflow-hidden', faded && 'opacity-45')}
      style={{
        backgroundImage: LANDSCAPE,
        backgroundColor: multiply,
        backgroundBlendMode: multiply ? 'multiply' : undefined,
      }}
    >
      {children}
      {tint ? <span data-slot="sky-tint" className="absolute inset-0 block mix-blend-multiply" style={{ backgroundColor: tint }} /> : null}
    </span>
  );
}

const dot = 'absolute block rounded-full';

function DaySun() {
  return (
    <span
      className={cn(dot, 'top-1 left-1/2 size-3 -translate-x-1/2 border-[1.5px]')}
      style={{ backgroundColor: '#ffe27a', borderColor: '#c9a52e' }}
    />
  );
}

/** A half sun on the horizon line, `side` it rises or sets on. */
function HalfSun({ color, side }: { color: string; side: 'left' | 'right' }) {
  return (
    <span
      className={cn('absolute bottom-0 block h-2 w-4 rounded-t-full', side === 'left' ? 'left-1.5' : 'right-1.5')}
      style={{ backgroundColor: color }}
    />
  );
}

function Moon() {
  return <span className={cn(dot, 'top-1 right-1.5 size-2.5')} style={{ backgroundColor: '#eef1f9' }} />;
}

function Planks() {
  return (
    <span
      className="absolute inset-1.5 block border-[3px]"
      style={{
        borderColor: '#5b5148',
        backgroundImage: 'repeating-linear-gradient(90deg, #c9ad84 0 4px, #b0946c 4px 8px)',
      }}
    />
  );
}

function Rock() {
  return (
    <span className="absolute inset-0 block" style={{ backgroundColor: '#8b867f' }}>
      <span
        className={cn(dot, 'top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2')}
        style={{ background: 'radial-gradient(circle, rgba(255,190,110,0.95) 0 20%, rgba(255,150,60,0) 70%)' }}
      />
    </span>
  );
}

const TIME_PICTURE: Record<SkyTime, { multiply: string; mark: React.ReactNode }> = {
  dawn: { multiply: '#c2ac9c', mark: <HalfSun color="#ffd9a0" side="left" /> },
  day: { multiply: '#ffffff', mark: <DaySun /> },
  dusk: { multiply: '#b8907a', mark: <HalfSun color="#ff9d5c" side="right" /> },
  night: { multiply: '#48526e', mark: <Moon /> },
};

const PLACE_PICTURE: Record<SkyPlace, { multiply: string; mark: React.ReactNode }> = {
  outdoor: { multiply: '#ffffff', mark: <DaySun /> },
  indoor: { multiply: '#b4b4b4', mark: <Planks /> },
  underground: { multiply: '#3a3a3a', mark: <Rock /> },
};

const TIMES: { value: SkyTime; name: string }[] = [
  { value: 'dawn', name: 'Dawn' },
  { value: 'day', name: 'Day' },
  { value: 'dusk', name: 'Dusk' },
  { value: 'night', name: 'Night' },
];

const PLACES: { value: SkyPlace; name: string }[] = [
  { value: 'outdoor', name: 'Outdoor' },
  { value: 'indoor', name: 'Indoor' },
  { value: 'underground', name: 'Underground' },
];

type TimeTilesProps = {
  value: SkyTime | 'unlit';
  onPick: (value: SkyTime | 'unlit') => void;
  /** Lead with an Unlit entry (the plain strip, no mark). */
  unlit?: boolean;
  /** The colour each time is drawn in, multiplied into its picture (the map's tint, or the time's own). */
  tints?: Partial<Record<SkyTime, string>>;
  className?: string;
  'aria-label'?: string;
};

/** A row of picture tiles that picks a time of day, optionally led by Unlit. */
function TimeTiles({ value, onPick, unlit, tints, className, 'aria-label': label = 'Time of day' }: TimeTilesProps) {
  return (
    <div role="group" aria-label={label} data-composite="time-tiles" className={cn('flex flex-wrap gap-1.5', className)}>
      {unlit ? (
        <Tile name="Unlit" active={value === 'unlit'} data-value="unlit" onClick={() => onPick('unlit')}>
          <Strip />
        </Tile>
      ) : null}
      {TIMES.map((t) => (
        <Tile key={t.value} name={t.name} active={value === t.value} data-value={t.value} onClick={() => onPick(t.value)}>
          <Strip multiply={TIME_PICTURE[t.value].multiply} tint={tints?.[t.value]}>
            {TIME_PICTURE[t.value].mark}
          </Strip>
        </Tile>
      ))}
    </div>
  );
}

type PlaceTilesProps = {
  /** The pinned place, or null while the inherit entry is the choice. */
  value: SkyPlace | null;
  onPick: (value: SkyPlace | null) => void;
  /** Lead with an inherit entry ("Follows", "As built"), drawn faded as the place it resolves to. */
  inherit?: { label: string; resolves: SkyPlace };
  /** The tiles share the row's width in place of the fixed 56 (the Sky sheet's three). */
  wide?: boolean;
  className?: string;
  'aria-label'?: string;
};

const WIDE_TILE = 'w-auto flex-1 [&>[data-slot=tile-name]]:max-w-full [&>[data-slot=tile-thumb]]:w-full';

/** A row of picture tiles that picks a place, optionally led by an inherit entry. */
function PlaceTiles({ value, onPick, inherit, wide, className, 'aria-label': label = 'Place' }: PlaceTilesProps) {
  const tile = wide ? WIDE_TILE : undefined;
  return (
    <div role="group" aria-label={label} data-composite="place-tiles" className={cn('flex gap-1.5', wide ? 'flex-nowrap' : 'flex-wrap', className)}>
      {inherit ? (
        <Tile name={inherit.label} active={value === null} data-value="inherit" className={tile} onClick={() => onPick(null)}>
          <Strip multiply={PLACE_PICTURE[inherit.resolves].multiply} faded>
            {PLACE_PICTURE[inherit.resolves].mark}
          </Strip>
        </Tile>
      ) : null}
      {PLACES.map((p) => (
        <Tile key={p.value} name={p.name} active={value === p.value} data-value={p.value} className={tile} onClick={() => onPick(p.value)}>
          <Strip multiply={PLACE_PICTURE[p.value].multiply}>{PLACE_PICTURE[p.value].mark}</Strip>
        </Tile>
      ))}
    </div>
  );
}

export { PlaceTiles, TimeTiles };
