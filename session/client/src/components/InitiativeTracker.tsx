// The turn order, as both seats read it: the order, the numbers, whose turn it is and which
// round. Registered chrome-less (no panel `title`) on purpose — `trackerView` returning null
// has to take the heading with it, and a panel title is drawn by the shell, not by this.

import type { InitiativeState } from '@dnd/mechanics/initiative';
import { trackerView } from '../session/initiativeView';
import { ALL_ROLES, registerPanel } from '../session/panels';
import { useModuleState, useSessionStore } from '../session/store';

export function InitiativeTracker() {
  const state = useModuleState<InitiativeState>('initiative');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const view = trackerView(state, sceneId);
  if (!view) return null;

  return (
    <div>
      <h2 className="mb-1 flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        <span>Initiative</span>
        <span className="font-normal normal-case tracking-normal">
          {view.status === 'running' ? `Round ${view.round}` : 'Rolling'}
        </span>
      </h2>
      <ol data-testid="initiative-tracker" className="flex flex-col gap-0.5">
        {view.rows.map((row) => (
          <li
            key={row.key}
            aria-current={row.current ? 'true' : undefined}
            // The transparent border on every other row is what keeps the list from
            // shifting a pixel sideways each time the turn moves.
            className={`flex items-center gap-2 rounded border px-1.5 py-0.5 text-sm ${
              row.current
                ? 'border-border-focus bg-surface-2 text-text-primary'
                : 'border-transparent text-text-secondary'
            } ${row.down ? 'opacity-50' : ''}`}
          >
            <span className={`min-w-0 flex-1 truncate ${row.down ? 'line-through' : ''}`}>
              {row.name}
            </span>
            {row.conditions.map((c) => (
              <span
                key={c}
                className="rounded border border-border-default px-1 text-[10px] uppercase tracking-wide"
              >
                {c}
              </span>
            ))}
            {row.hp && (
              <span className="font-mono text-xs" aria-label={`HP ${row.hp}`}>
                {row.hp}
              </span>
            )}
            <span className="w-6 text-right font-mono text-xs">{row.initiative ?? '—'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

registerPanel({ id: 'initiative', roles: ALL_ROLES, order: 5, component: InitiativeTracker });
