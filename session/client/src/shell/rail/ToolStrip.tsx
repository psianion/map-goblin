import type { Role } from '@dnd/core/src/shared/protocol';
import { Button, Seg, type SegOption } from '@dnd/ui';
import { Eraser, LocateFixed } from '@dnd/ui/icons';
import { useRole } from '../../session/store';
import { toolLabel, useActiveTool } from '../../session/tools';
import { pullEveryoneHere } from '../marks/markInput';
import { clearAll, useMarks, useTemplateShape, type TemplateShape } from '../marks/marks';
import { railTool, type RailToolId } from './registry';
import { activeRailTool } from './tools';

const SHAPES: SegOption[] = [
  { value: 'circle', label: 'Circle', testId: 'template-shape-circle' },
  { value: 'cone', label: 'Cone', testId: 'template-shape-cone' },
  { value: 'line', label: 'Line', testId: 'template-shape-line' },
  { value: 'square', label: 'Square', testId: 'template-shape-square' },
];

/** What a click does with the tool in hand, in one line. */
function hintFor(id: RailToolId, role: Role): string {
  switch (id) {
    case 'ping':
      return role === 'dm' ? 'Click to ping a spot. Shift+Alt+click pulls everyone’s view there.' : 'Click to ping a spot for the table.';
    case 'measure':
      return 'Drag to count cells, a diagonal as one. Hold Alt for a straight line. Esc or right-click cancels.';
    case 'template':
      return 'Drag from a corner or a cell centre. Click a template to take it away.';
    case 'draw':
      return 'Drag to draw. A drawing fades after ten seconds.';
    case 'pin':
      return 'Click to drop a pin, or click a pin to edit it.';
    default:
      return '';
  }
}

const Clear = ({ what, testId, children }: { what: 'template' | 'draw'; testId: string; children: string }) => {
  const any = useMarks((s) => s.marks.some((m) => m.msg.kind === what));
  return (
    <Button variant="outline" size="sm" className="self-start" data-testid={testId} disabled={!any} onClick={() => clearAll(what)}>
      <Eraser />
      {children}
    </Button>
  );
};

/**
 * The options strip beside the rail while a mark tool is in hand: its name, its options, what
 * a click does, and its clear button. Nothing for Select, nothing for a dock tool.
 */
export function ToolStrip() {
  const role = useRole();
  const tool = useActiveTool((s) => s.activeTool);
  const shape = useTemplateShape((s) => s.shape);
  const rail = activeRailTool(tool);
  const def = rail && rail !== 'select' ? railTool(rail) : undefined;
  if (!role || !def || !tool) return null;
  const Icon = def.icon;
  const hint = hintFor(def.id, role);
  return (
    <section
      aria-label={`${def.title} options`}
      data-testid="tool-strip"
      data-tool={def.id}
      data-chrome
      className="absolute top-16 left-[64px] z-20 flex w-[248px] max-w-[calc(100vw-76px)] flex-col gap-2 rounded-float border border-line bg-panel p-2.5 shadow-e animate-in fade-in-0 duration-150 motion-safe:slide-in-from-left-1"
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-text">
        <Icon className="size-3.5 text-text-2" aria-hidden />
        {toolLabel(tool)}
      </div>
      {def.id === 'template' && (
        <Seg
          aria-label="Template shape"
          options={SHAPES}
          value={shape}
          onValueChange={(v) => useTemplateShape.getState().setShape(v as TemplateShape)}
        />
      )}
      <p className="text-[11px] leading-snug text-text-3" data-testid="tool-strip-hint">
        {hint}
      </p>
      {def.id === 'ping' && role === 'dm' && (
        <Button variant="outline" size="sm" className="self-start" data-testid="strip-pull" onClick={pullEveryoneHere}>
          <LocateFixed />
          Pull everyone here
        </Button>
      )}
      {def.id === 'template' && (
        <Clear what="template" testId="strip-clear-templates">
          Clear templates
        </Clear>
      )}
      {def.id === 'draw' && (
        <Clear what="draw" testId="strip-clear-drawings">
          Clear drawings
        </Clear>
      )}
    </section>
  );
}
