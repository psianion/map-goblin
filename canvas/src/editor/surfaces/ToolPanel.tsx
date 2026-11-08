import { ArrowLeft } from 'lucide-react';
import { Caption, FloatBox, IconKeyButton, PanelHeader, SecondaryButton } from '@/editor/components';
import { useStore } from '@/store/store';
import type { ToolDef } from '@/editor/registry';
import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';
import { pickTool, useFamilyOf } from './hooks';
import { groupBySection } from './sections';
import { ToolSetting } from './SettingItems';

/** The slot's width: 272, so a 248 setting row sits inside 12 either side. */
export const SLOT_W = 272;

/**
 * How the tool in hand behaves: its panel settings under their captions, in registry
 * order, never a dock setting. The header's switcher row changes tool within the family
 * without the flyout; the foot resets the tool or saves a preset where it keeps them.
 */
export function ToolPanel({ tool }: { tool: ToolDef }) {
  const { registry, settings } = useRegistry();
  const family = useFamilyOf(tool);
  const sections = groupBySection(registry.settingsByHome(tool.id, 'panel'));
  // Reset puts the tool's saved settings back; a tool with none has no Reset.
  const resettable = tool.settings.some((s) => s.persist !== false);
  // A rail tool (Select) offers the way back to the last family tool in hand.
  const lastId = useShell((s) => s.lastToolId);
  const previous = !family && lastId ? registry.toolById(lastId) : undefined;
  const Extra = tool.panelExtra;
  return (
    <FloatBox className="flex w-[272px] flex-col overflow-hidden p-0" data-testid="shell-tool-panel" data-tool={tool.id}>
      <PanelHeader path={family ? [family.label] : []} title={tool.label}>
        {family?.tools.map((t) => (
          <IconKeyButton
            key={t.id}
            size={26}
            icon={t.icon}
            label={t.label}
            shortcut={t.key}
            active={t.id === tool.id}
            data-tip={t.label}
            data-tip-key={t.key}
            data-tip-side="bottom"
            onClick={() => pickTool(t)}
          />
        ))}
        {previous && (
          <IconKeyButton
            size={26}
            icon={ArrowLeft}
            label={`Back to ${previous.label}`}
            shortcut="X"
            data-tip="Previous tool"
            data-tip-key="X"
            data-tip-side="bottom"
            onClick={() => pickTool(previous)}
          />
        )}
      </PanelHeader>
      {(sections.length > 0 || Extra) && (
        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-3">
          {sections.map((sec, i) => (
            <div key={sec.title ?? `s${i}`} className="flex flex-col gap-px" data-section={sec.title ?? ''}>
              {sec.title && <Caption className="mb-1.5">{sec.title}</Caption>}
              {sec.items.map((def) => (
                <ToolSetting key={def.id} def={def} />
              ))}
            </div>
          ))}
          {Extra && <Extra tool={tool} />}
        </div>
      )}
      {(resettable || tool.savePreset) && (
        <div className="flex gap-1.5 border-t border-line px-3 py-2">
          {resettable && <SecondaryButton onClick={() => settings.resetTool(tool.id)}>Reset</SecondaryButton>}
          {tool.savePreset && <SecondaryButton onClick={() => tool.savePreset?.(useStore)}>Save as preset</SecondaryButton>}
        </div>
      )}
    </FloatBox>
  );
}
