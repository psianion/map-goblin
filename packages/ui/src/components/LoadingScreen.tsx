import { Check, Circle, LoaderCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { progressDetail, progressFraction, type LoadProgress } from '../lib/format';

type LoadingScreenProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: string;
  steps: readonly string[];
  /** The live step's index; the steps before it are done. */
  current: number;
  /** The live step's download. Indeterminate while absent or while `filesTotal` is 0. */
  progress?: LoadProgress | null;
};

/**
 * The first-load screen: the desk with a centred card, the steps with the live one marked,
 * a bar and the file and byte counts. Covers its positioned parent.
 */
function LoadingScreen({ title, steps, current, progress, className, ...props }: LoadingScreenProps) {
  const fraction = progressFraction(progress);
  return (
    <div
      data-composite="loading-screen"
      data-testid="loading-screen"
      role="status"
      aria-live="polite"
      className={cn('absolute inset-0 z-40 flex items-center justify-center bg-bg font-sans text-text', className)}
      {...props}
    >
      <div className="flex w-80 flex-col gap-3 rounded-float border border-line bg-panel p-4 shadow-e">
        <div className="text-[13px] font-medium">{title}</div>
        <ol className="flex flex-col gap-1.5 text-[12px]">
          {steps.map((label, i) => {
            const state = i < current ? 'done' : i === current ? 'live' : 'waiting';
            const Icon = state === 'done' ? Check : state === 'live' ? LoaderCircle : Circle;
            return (
              <li
                key={label}
                data-step-state={state}
                aria-current={state === 'live' ? 'step' : undefined}
                className={cn('flex items-center gap-2', state === 'live' ? 'text-text' : state === 'done' ? 'text-text-2' : 'text-text-3')}
              >
                <Icon aria-hidden strokeWidth={1.75} className={cn('size-3.5', state === 'live' && 'animate-spin')} />
                {label}
              </li>
            );
          })}
        </ol>
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
          data-indeterminate={fraction === null ? '' : undefined}
          className="h-1 overflow-hidden rounded-pill bg-panel-3"
        >
          <div
            className={cn('h-full rounded-pill bg-ink transition-[width] duration-200', fraction === null && 'w-1/3 animate-pulse')}
            style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
          />
        </div>
        <div className="min-h-4 font-mono text-[11px] text-text-3 tabular-nums">
          {progress && progress.filesTotal > 0 ? progressDetail(progress) : null}
        </div>
      </div>
    </div>
  );
}

export { LoadingScreen };
