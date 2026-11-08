import { useEffect, useState } from 'react';
import { StatusChip } from '@dnd/ui';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useSessionStore } from '../session/store';
import { useShell } from './shellStore';

/** View → Diagnostics (Shift+D): frame rate, frame time and round trip, off by default. */
export function DiagnosticsChip() {
  const on = useShell((s) => s.diagnostics);
  const latencyMs = useSessionStore((s) => s.latencyMs);
  const [frame, setFrame] = useState<{ fps: string; ms: string }>({ fps: '—', ms: '—' });
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => {
      const ticker = getEngineSingleton()?.engine.ticker();
      setFrame(ticker ? { fps: String(Math.round(ticker.FPS)), ms: ticker.deltaMS.toFixed(1) } : { fps: '—', ms: '—' });
    }, 250);
    return () => clearInterval(timer);
  }, [on]);
  if (!on) return null;
  return (
    <StatusChip
      data-testid="diagnostics"
      className="absolute top-16 left-16 z-20 h-8 rounded-control border border-line bg-panel px-2.5 shadow-e"
    >
      {frame.fps} FPS · {frame.ms} ms{latencyMs !== null ? ` · ${Math.round(latencyMs)} ms rtt` : ''}
    </StatusChip>
  );
}
