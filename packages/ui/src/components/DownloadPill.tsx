import { ChevronDown, Pause, Play, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { progressDetail, progressFraction, type LoadProgress } from '../lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover';
import { SecondaryButton } from './SecondaryButton';

/** One pack's line in the pill's popover. */
export interface DownloadPillPack {
  id: string;
  label: string;
  status: 'done' | 'active' | 'waiting';
  /** The active pack's counts. */
  progress?: LoadProgress;
}

type DownloadPillProps = {
  /** `map`: the sets the open map needs. `library`: everything else, in the background. */
  phase: 'map' | 'library';
  progress: LoadProgress;
  packs?: readonly DownloadPillPack[];
  paused?: boolean;
  /** Both given: the popover has Pause or Resume. */
  onPause?: () => void;
  onResume?: () => void;
  /** The ×: the surface hides the pill for the session; the download carries on. */
  onHide: () => void;
  className?: string;
};

const RING_R = 5;
const RING_C = 2 * Math.PI * RING_R;

/** A 14px ring, ink over the line colour; a quarter arc spins while nothing is counted. */
function Ring({ fraction }: { fraction: number | null }) {
  const shown = fraction ?? 0.25;
  return (
    <svg aria-hidden viewBox="0 0 14 14" className={cn('size-3.5 -rotate-90', fraction === null && 'animate-spin')}>
      <circle cx="7" cy="7" r={RING_R} fill="none" strokeWidth="2" className="stroke-line" />
      <circle
        cx="7"
        cy="7"
        r={RING_R}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${shown * RING_C} ${RING_C}`}
        className="stroke-ink"
      />
    </svg>
  );
}

/** "Library · 62%" or "Map · 3 of 12". */
function pillLabel(phase: DownloadPillProps['phase'], p: LoadProgress, paused: boolean): string {
  if (phase === 'map') return p.filesTotal > 0 ? `Map · ${p.filesDone} of ${p.filesTotal}` : 'Map';
  if (paused) return 'Library · paused';
  const f = progressFraction(p);
  return f === null ? 'Library' : `Library · ${Math.floor(f * 100)}%`;
}

function packLine(pack: DownloadPillPack): string {
  if (pack.status === 'done') return 'Done';
  if (pack.status === 'waiting') return 'Waiting';
  return pack.progress && pack.progress.filesTotal > 0 ? progressDetail(pack.progress) : 'Starting';
}

/**
 * The background download in a top bar: a ring and a label, a chevron that opens the
 * per-pack lines with Pause or Resume, and an × that hides it.
 */
function DownloadPill({ phase, progress, packs, paused = false, onPause, onResume, onHide, className }: DownloadPillProps) {
  const label = pillLabel(phase, progress, paused);
  const canPause = onPause !== undefined && onResume !== undefined;
  return (
    <div
      data-composite="download-pill"
      data-testid="download-pill"
      data-phase={phase}
      role="status"
      className={cn(
        'inline-flex h-7 items-center gap-0.5 rounded-pill border border-line bg-panel pr-0.5 pl-1 font-mono text-[11px] whitespace-nowrap text-text-2 tabular-nums',
        className,
      )}
    >
      <Popover>
        <PopoverTrigger
          aria-label={`${label}, details`}
          className="inline-flex h-6 items-center gap-1.5 rounded-pill px-1.5 outline-none hover:bg-panel-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-expanded:bg-panel-3"
        >
          <Ring fraction={paused ? (progressFraction(progress) ?? 0) : progressFraction(progress)} />
          <span>{label}</span>
          <ChevronDown aria-hidden strokeWidth={1.75} className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <div className="text-[12px] font-medium text-text">{phase === 'map' ? 'Map textures' : 'Asset library'}</div>
          {packs && packs.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {packs.map((pack) => (
                <li key={pack.id} data-pack={pack.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className={pack.status === 'waiting' ? 'text-text-3' : 'text-text'}>{pack.label}</span>
                  <span className="font-mono text-[11px] text-text-3 tabular-nums">{packLine(pack)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="font-mono text-[11px] text-text-3 tabular-nums">
              {progress.filesTotal > 0 ? progressDetail(progress) : 'Starting'}
            </div>
          )}
          {canPause ? (
            <div className="flex justify-end">
              {paused ? (
                <SecondaryButton icon={Play} onClick={onResume}>
                  Resume
                </SecondaryButton>
              ) : (
                <SecondaryButton icon={Pause} onClick={onPause}>
                  Pause
                </SecondaryButton>
              )}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label="Hide download progress"
        onClick={onHide}
        className="inline-flex size-6 items-center justify-center rounded-pill text-text-3 outline-none hover:bg-panel-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        <X aria-hidden strokeWidth={1.75} className="size-3" />
      </button>
    </div>
  );
}

export { DownloadPill };
