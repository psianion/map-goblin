import { ClipboardList, Eraser, Hand, MousePointer2, Ruler, Spline } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '@/store/store';
import type { ToolType } from '@/store/types';
import { cn } from '@/lib/utils';

const RAIL_TOOLS: { tool: ToolType; label: string; shortcut: string; icon: LucideIcon }[] = [
  { tool: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
  { tool: 'pan', label: 'Pan', shortcut: 'G', icon: Hand },
  { tool: 'ruler', label: 'Measure', shortcut: 'M', icon: Ruler },
];

type Mode = 'eraseMode' | 'curveMode';

const MODES: { mode: Mode; label: string; shortcut: string; icon: LucideIcon }[] = [
  { mode: 'eraseMode', label: 'Erase mode', shortcut: 'E', icon: Eraser },
  { mode: 'curveMode', label: 'Curve mode', shortcut: 'C', icon: Spline },
];

interface RailProps {
  prepOpen: boolean;
  onTogglePrep: () => void;
}

/** Left rail: the tools that act on what is already drawn, the drawing modes, then the prep overview. */
export function Rail({ prepOpen, onTogglePrep }: RailProps) {
  const activeTool = useStore((s) => s.tools.activeTool);
  const eraseMode = useStore((s) => s.tools.eraseMode);
  const curveMode = useStore((s) => s.tools.curveMode);
  const on: Record<Mode, boolean> = { eraseMode, curveMode };

  const setMode = (mode: Mode, next: boolean) => {
    const s = useStore.getState();
    if (mode === 'eraseMode') s.setEraseMode(next);
    else s.setCurveMode(next);
  };

  return (
    <nav className="v2-rail" data-testid="v2-rail" data-chrome aria-label="Tools">
      <div className="v2-rail__group">
        {RAIL_TOOLS.map(({ tool, label, shortcut, icon: Icon }) => (
          <button
            key={tool}
            type="button"
            className={cn('v2-ib v2-ib--lg', activeTool === tool && 'v2-ib--on')}
            aria-label={`${label} (${shortcut})`}
            aria-pressed={activeTool === tool}
            data-tip={label}
            data-tip-key={shortcut}
            data-tip-side="right"
            onClick={() => useStore.getState().setActiveTool(tool)}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <div className="v2-rail__divider" role="separator" />
      <div className="v2-rail__group">
        {MODES.map(({ mode, label, shortcut, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={cn('v2-ib v2-ib--lg', on[mode] && 'v2-ib--on')}
            aria-label={`${label} (${shortcut})`}
            aria-pressed={on[mode]}
            data-tip={label}
            data-tip-key={shortcut}
            data-tip-side="right"
            onClick={() => setMode(mode, !on[mode])}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <div className="v2-rail__group v2-rail__group--end">
        <button
          type="button"
          className={cn('v2-ib v2-ib--lg', prepOpen && 'v2-ib--on')}
          aria-label="Prep overview"
          aria-pressed={prepOpen}
          data-tip="Prep"
          data-tip-side="right"
          data-testid="v2-rail-prep"
          onClick={onTogglePrep}
        >
          <ClipboardList size={16} strokeWidth={1.75} />
        </button>
      </div>
    </nav>
  );
}
