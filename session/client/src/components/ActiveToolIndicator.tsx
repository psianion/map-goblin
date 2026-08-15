import { toolLabel, useActiveTool } from '../session/tools';
import { useRole } from '../session/store';

/**
 * Which tool has the map, permanently on screen (D11). It reads "None" rather than
 * disappearing on purpose: a DM who cannot remember whether a click will move a token or
 * re-hide a room has to try it to find out, and finding out costs a room.
 *
 * DM-only — players have no tools, and a permanent "None" would be chrome that never once
 * changes for them.
 */
export function ActiveToolIndicator() {
  const activeTool = useActiveTool((s) => s.activeTool);
  const toolDetail = useActiveTool((s) => s.toolDetail);
  const setActiveTool = useActiveTool((s) => s.setActiveTool);
  const isDm = useRole() === 'dm';

  if (!isDm) return null;

  return (
    <div
      data-testid="active-tool"
      data-tool={activeTool ?? 'none'}
      className="pointer-events-none absolute bottom-10 left-3 z-toolbar flex items-center gap-2 rounded border border-border-default bg-surface-1/95 px-2.5 py-1.5 text-xs"
    >
      <span className="text-text-secondary">Tool</span>
      {activeTool ? (
        <>
          {/* Filled dot + name + the key: three encodings, none of them colour alone. The name
              carries the sub-mode too ("Fog · Brush"), because a sub-mode changes what a click
              does as much as the tool does. The exit label stays the tool's own name: Esc
              leaves the tool, not the brush. */}
          <span className="h-1.5 w-1.5 rounded-full bg-accent-active" aria-hidden />
          <span className="font-medium text-text-primary">{toolLabel(activeTool, toolDetail)}</span>
          <button
            type="button"
            data-testid="active-tool-exit"
            aria-label={`Exit the ${toolLabel(activeTool)} tool`}
            onClick={() => setActiveTool(null)}
            className="pointer-events-auto rounded-chip border border-border-default px-1.5 py-0.5 font-mono text-[11px] text-text-secondary transition-colors duration-150 ease-out-quart hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-0 motion-reduce:transition-none"
          >
            Esc
          </button>
        </>
      ) : (
        <span className="text-text-secondary">None</span>
      )}
    </div>
  );
}
