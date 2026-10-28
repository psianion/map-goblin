import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { SetAmbientLightCommand, SetEnvironmentSettingsCommand } from '@/store/commands';
import { NOON, TIME_PALETTES, DEFAULT_PALETTE, type Environment, type MapEnvironment, type NightSky } from '@/store/types';
import { WEATHERS, vocabLabel, type Weather } from '@dnd/core/src/shared/prep';
import { cn } from '@/lib/utils';
import { ColorCtl, Slider } from './controls';
import { getSkyPreviewOpen, setLitPreview, setSkyPreviewOpen, useLitPreview } from '../viewPrefs';
import { hhmm } from './lightModel';
import './rooms.css';
import './selection-card.css';
import './lighting.css';

/*
 * The Sky & mood sheet (board 4): the map's sky defaults, its time, what the table starts
 * from, the mood tint, and preview rows that change only what the editor shows. Every saved
 * change is one undo step; a drag on a slider, the dial or the tint picker previews live and
 * lands as one step when it ends.
 */

const ENVIRONMENT_CHOICES: { value: Environment; label: string }[] = [
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'underground', label: 'Underground' },
];

const SKY_CHOICES: { value: NightSky; label: string }[] = [
  { value: 'full-moon', label: 'Full moon' },
  { value: 'crescent', label: 'Crescent' },
  { value: 'moonless', label: 'Moonless' },
];

const TIME_CHOICES: { value: 'clock' | 'fixed'; label: string }[] = [
  { value: 'clock', label: 'Follow clock' },
  { value: 'fixed', label: 'Fixed hour' },
];

const WEATHER_CHOICES: { value: Weather; label: string }[] = WEATHERS.map((w) => ({ value: w, label: vocabLabel(w) }));

const CLIMATES = Object.keys(TIME_PALETTES).map((id) => ({ value: id, label: id[0].toUpperCase() + id.slice(1) }));

/** The last hour the sliders reach: a quarter before midnight. */
const LAST_MINUTE = 1440 - 15;

/** One undo step for a change to the map's sky settings (`before` is what they held). */
function commitEnv(patch: Partial<MapEnvironment>, before?: Partial<MapEnvironment>): void {
  const map = useStore.getState().mapSettings as MapEnvironment;
  const prev = before ?? (Object.fromEntries(Object.keys(patch).map((k) => [k, map[k as keyof MapEnvironment]])) as Partial<MapEnvironment>);
  if (JSON.stringify(prev) === JSON.stringify(patch)) return;
  undoManager.execute(new SetEnvironmentSettingsCommand(prev, patch));
}

/** What the map held, key by key, before the drag under way first wrote over it. */
let dragStart: Partial<MapEnvironment> | null = null;

/** A live drag on one sky setting: the store follows the pointer, the end lands one step. */
function liveEnv(patch: Partial<MapEnvironment>): void {
  const map = useStore.getState().mapSettings as MapEnvironment;
  dragStart ??= {};
  for (const k of Object.keys(patch) as (keyof MapEnvironment)[]) if (!(k in dragStart)) Object.assign(dragStart, { [k]: map[k] });
  useStore.getState().setEnvironmentSettings(patch);
}

/** The drag's end: one step from what the map held when it began (an absent key stays absent on undo). */
function commitDrag(patch: Partial<MapEnvironment>): void {
  const start = dragStart;
  dragStart = null;
  if (start) commitEnv(patch, start);
}

function SheetSection({
  title,
  quiet,
  open,
  onFold,
  children,
  testId,
}: {
  title: string;
  quiet?: string;
  open: boolean;
  onFold: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="v2-rsec" data-testid={testId}>
      <div className="v2-rsec__head">
        <button type="button" className="v2-selc__disclose" aria-expanded={open} onClick={onFold}>
          <ChevronRight size={12} strokeWidth={2} aria-hidden />
          <span>{title}</span>
        </button>
        {quiet && <span className="v2-rquiet">{quiet}</span>}
      </div>
      {open && children}
    </div>
  );
}

function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="v2-rrow">
      <span className="v2-rrow__lbl">{label}</span>
      <span className="v2-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => value !== o.value && onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="v2-rrow v2-selc">
      <div className="v2-ctl">
        <span className="v2-ctl__head">
          <span>{label}</span>
        </span>
        <span className="v2-ctl__body">
          <select className="v2-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      </div>
    </div>
  );
}

function SwitchRow({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="v2-rrow">
      <span className="v2-rrow__lbl">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn('v2-switch', checked && 'v2-switch--on')}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
      {children}
    </div>
  );
}

const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/**
 * The map's orientation as a compass dial: the needle points where the sun comes up, 0° east,
 * clockwise. A drag turns it live and lands as one step; the arrow keys step by 5°.
 */
export function OrientationDial({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (deg: number) => void;
  onCommit: (deg: number, start: number) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const start = useRef<number | null>(null);
  const last = useRef(value);
  const angleAt = (e: PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return value;
    return norm((Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2)) * 180) / Math.PI);
  };
  const move = (deg: number) => {
    last.current = deg;
    onChange(deg);
  };
  const end = () => {
    if (start.current === null) return;
    const from = start.current;
    start.current = null;
    onCommit(last.current, from);
  };
  return (
    <span
      ref={ref}
      className="v2-dial"
      role="slider"
      tabIndex={0}
      aria-label="Orientation"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={value}
      aria-valuetext={`${value}°`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = value;
        move(angleAt(e));
      }}
      onPointerMove={(e) => {
        if (start.current !== null) move(angleAt(e));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e: KeyboardEvent) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        const next = norm(value + step);
        onChange(next);
        onCommit(next, value);
      }}
    >
      <svg viewBox="0 0 44 44" aria-hidden>
        <path className="v2-dial__tick" d="M22 4v4M22 36v4M4 22h4M36 22h4" strokeWidth="1" />
        <text className="v2-dial__n" x="22" y="15" textAnchor="middle" fontFamily="IBM Plex Sans" fontSize="7">
          N
        </text>
        <g transform={`rotate(${value} 22 22)`}>
          <path className="v2-dial__needle" d="M22 22H37" strokeWidth="1.5" strokeLinecap="round" />
          <circle className="v2-dial__tip" cx="37" cy="22" r="3" />
        </g>
        <circle className="v2-dial__hub" cx="22" cy="22" r="2" strokeWidth="1.3" />
      </svg>
    </span>
  );
}

/** The sheet's body: Place, Time, Defaults at the table, Mood tint, Preview. */
export function SkySheet() {
  const map = useStore(
    useShallow((s) => ({
      environment: s.mapSettings.environment ?? 'indoor',
      preset: s.mapSettings.timePalette?.preset ?? DEFAULT_PALETTE,
      timePalette: s.mapSettings.timePalette,
      naturalLight: s.mapSettings.naturalLight === true,
      orientation: s.mapSettings.orientation ?? 0,
      timeMode: s.mapSettings.timeMode ?? 'clock',
      fixedTime: s.mapSettings.fixedTime ?? NOON,
      weather: s.mapSettings.weather ?? 'clear',
      nightSky: s.mapSettings.nightSky ?? 'full-moon',
      ambientLight: s.mapSettings.ambientLight,
    })),
  );
  const preview = useStore(
    useShallow((s) => ({ clock: s.ui.previewClock, sky: s.ui.previewSky, weather: s.ui.previewWeather })),
  );
  const lit = useLitPreview();
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpenState] = useState(getSkyPreviewOpen);
  const open = (t: string) => folds[t] !== false;
  const fold = (t: string) => setFolds((f) => ({ ...f, [t]: f[t] === false }));
  const fixed = map.timeMode === 'fixed';
  const previewClock = preview.clock ?? (fixed ? map.fixedTime : NOON);
  const s = useStore.getState();

  return (
    <>
      <SheetSection title="Place" open={open('Place')} onFold={() => fold('Place')} testId="v2-sky-place">
        <SegRow label="Environment" value={map.environment} options={ENVIRONMENT_CHOICES} onChange={(v) => commitEnv({ environment: v })} />
        <SelectRow
          label="Climate"
          value={map.preset}
          options={CLIMATES}
          onChange={(v) => commitEnv({ timePalette: { ...map.timePalette, preset: v } })}
        />
        <SwitchRow label="Natural shadows" checked={map.naturalLight} onChange={(v) => commitEnv({ naturalLight: v })} />
        <div className="v2-rrow">
          <span className="v2-rrow__lbl">Orientation</span>
          <OrientationDial
            value={map.orientation}
            onChange={(deg) => liveEnv({ orientation: deg })}
            onCommit={(deg) => commitDrag({ orientation: deg })}
          />
          <span className="v2-num v2-rsmall">{map.orientation}°</span>
          <span className="v2-rquiet v2-rend">0° is east</span>
        </div>
      </SheetSection>

      <SheetSection title="Time" open={open('Time')} onFold={() => fold('Time')} testId="v2-sky-time">
        <SegRow label="Time" value={map.timeMode} options={TIME_CHOICES} onChange={(v) => commitEnv({ timeMode: v })} />
        <div className={cn('v2-rrow v2-selc', !fixed && 'v2-prow--off')}>
          <Slider
            label="Fixed hour"
            value={map.fixedTime}
            min={0}
            max={LAST_MINUTE}
            step={15}
            format={hhmm}
            onChange={(v) => liveEnv({ fixedTime: v })}
            onCommit={(v) => commitDrag({ fixedTime: v })}
          />
        </div>
      </SheetSection>

      <SheetSection title="Defaults at the table" open={open('Defaults')} onFold={() => fold('Defaults')} testId="v2-sky-defaults">
        <SelectRow label="Weather" value={map.weather} options={WEATHER_CHOICES} onChange={(v) => commitEnv({ weather: v })} />
        <SegRow label="Night sky" value={map.nightSky} options={SKY_CHOICES} onChange={(v) => commitEnv({ nightSky: v })} />
      </SheetSection>

      <SheetSection title="Mood tint" open={open('Mood tint')} onFold={() => fold('Mood tint')} testId="v2-sky-tint">
        <div className="v2-rrow v2-selc">
          <ColorCtl
            label="Tint"
            placement="beside"
            value={map.ambientLight}
            onChange={(c) => useStore.getState().setAmbientLight(c)}
            onCommit={(c, from) => {
              if (c.toLowerCase() !== from.toLowerCase()) undoManager.execute(new SetAmbientLightCommand(from, c));
            }}
          />
          <span className="v2-selc__value v2-num">{map.ambientLight.toUpperCase()}</span>
        </div>
      </SheetSection>

      <SheetSection
        title="Preview"
        quiet="Preview only, not saved"
        open={previewOpen}
        onFold={() => {
          setSkyPreviewOpen(!previewOpen);
          setPreviewOpenState(!previewOpen);
        }}
        testId="v2-sky-preview"
      >
        <div className="v2-rrow v2-selc">
          <Slider label="Hour" value={previewClock} min={0} max={LAST_MINUTE} step={15} format={hhmm} onChange={(v) => s.setPreviewClock(v)} />
        </div>
        <SegRow label="Sky" value={preview.sky ?? map.nightSky} options={SKY_CHOICES} onChange={(v) => s.setPreviewSky(v)} />
        <SelectRow label="Weather" value={preview.weather ?? map.weather} options={WEATHER_CHOICES} onChange={(v) => s.setPreviewWeather(v)} />
        <SwitchRow label="Lit preview" checked={lit} onChange={setLitPreview}>
          <span className="v2-rquiet v2-rend">
            <kbd>I</kbd>
          </span>
        </SwitchRow>
      </SheetSection>
    </>
  );
}

/** The line under the sheet: what the table does with all this. */
export function SkySheetFoot() {
  return <footer className="v2-skysheet__foot">The table starts from these. At the table you change clock, sky and weather live.</footer>;
}
