import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DockColumn, FloatBox, IconKeyButton, LevelList, Button } from '@dnd/ui';
import { useStore } from '@/store/store';
import type { SettingDef, ToolDef } from '@/editor/registry';
import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';
import { pickTool, useActiveTool, useDockTool, useSettingGetter } from './hooks';
import { groupBySection } from './sections';
import { ToolSetting } from './SettingItems';
import { LayersColumn } from './LayersColumn';
import { LevelMenu } from './LevelMenu';
import { levelLabel } from './model';

/** The dock's height, whatever the tool: it never changes. */
export const DOCK_H = 112;

const chevron = <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5" />;

function LevelColumn() {
  const levels = useStore(useShallow((s) => s.levels));
  const activeLevelId = useStore((s) => s.ui.activeLevelId);
  // The store lists levels top first; the column reads the same, numbered from the ground up.
  const items = levels.map((l, i) => ({ id: l.id, label: levelLabel(i, levels.length, l.name) }));
  return (
    <DockColumn
      title="Level"
      data-column="level"
      control={
        <LevelMenu
          align="end"
          trigger={
            <Button variant="ghost" size="icon-xs" aria-label="Level menu" className="size-4 p-0 text-text-3">
              {chevron}
            </Button>
          }
        />
      }
    >
      <LevelList levels={items} value={activeLevelId} onValueChange={(id) => useStore.getState().setActiveLevelId(id)} />
    </DockColumn>
  );
}

/**
 * The tool's dock settings as columns, one per caption, the icon controls' names under them.
 * A caption whose settings are all hidden has no column.
 */
function SettingColumns({ defs }: { defs: readonly SettingDef[] }) {
  const get = useSettingGetter();
  return groupBySection(defs.filter((d) => !d.visibleWhen || d.visibleWhen(get))).map((sec, i) => {
    const iconNames = sec.items.filter((d) => d.control === 'switch' && d.icon).map((d) => d.label);
    const notes = sec.items.flatMap((d) => (d.note ? [d.note] : []));
    return (
      <DockColumn key={sec.title ?? `c${i}`} title={sec.title ?? sec.items[0].label} data-column={sec.title ?? sec.items[0].id}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            {sec.items.map((d) => (
              <ToolSetting key={d.id} def={d} compact />
            ))}
          </div>
          {iconNames.length > 0 && <div className="text-[10px] text-text-3">{iconNames.join(' · ')}</div>}
          {notes.map((n) => (
            <div key={n} className="text-[10px] text-text-3">
              {n}
            </div>
          ))}
        </div>
      </DockColumn>
    );
  });
}

/**
 * The family's tools, two rows deep, so a drawing hand changes tool without the flyout:
 * the family whose flyout is open, else the dock tool's.
 */
function FamilyColumn({ tool }: { tool: ToolDef | undefined }) {
  const { registry } = useRegistry();
  const flyout = useShell((s) => s.flyout);
  const active = useActiveTool();
  const family = (flyout ? registry.families.find((f) => f.id === flyout) : undefined) ?? (tool ? registry.familyOfTool(tool.id) : undefined);
  if (!family) return null;
  return (
    <DockColumn title={family.label} data-column="family">
      <div className="grid grid-flow-col grid-rows-2 gap-1">
        {family.tools.map((t) => (
          <IconKeyButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            shortcut={t.key}
            active={t.id === active?.id}
            data-tip={t.label}
            data-tip-key={t.key}
            onClick={() => {
              pickTool(t);
              useShell.getState().setFlyout(null);
            }}
          />
        ))}
      </div>
    </DockColumn>
  );
}

/**
 * The dock, 112 tall and never another height: Level and Layers, then what the tool in
 * hand uses. While drawing that is its dock settings (on-the-fly controls) and its own
 * columns; while a rail tool (Select) is in hand only the last family tool's own columns
 * stay, so a texture pick is still one click away.
 */
export const Dock = forwardRef<HTMLDivElement>(function Dock(_props, ref) {
  const { registry } = useRegistry();
  const { tool, drawing } = useDockTool();
  const dockSettings = tool && drawing ? registry.settingsByHome(tool.id, 'dock') : [];
  return (
    // Centred in what the rail and the gutters leave: from 68 to 12 short of the right edge.
    <FloatBox
      ref={ref}
      className="absolute bottom-10 left-[calc(50%+28px)] flex h-[112px] w-max max-w-[calc(100%-80px)] -translate-x-1/2 overflow-hidden p-0"
      data-testid="shell-dock"
      data-chrome
      data-keys="canvas"
      aria-label="Dock"
      role="region"
    >
      <LevelColumn />
      <LayersColumn />
      <FamilyColumn tool={tool} />
      {tool && <SettingColumns defs={dockSettings} />}
      {tool?.dock.map((col) => {
        const Render = col.render;
        return <Render key={col.id} tool={tool} />;
      })}
    </FloatBox>
  );
});
