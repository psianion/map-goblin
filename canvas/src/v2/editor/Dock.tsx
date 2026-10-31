import { forwardRef } from 'react';
import { ChevronDown, ChevronUp, PanelRight } from 'lucide-react';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type ToolType } from '@/store/types';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { DOCK_TABS, hasSwatches, tabForTool, type DockTab, type DockTabId, type ToolEntry } from './dockTabs';
import { Filmstrip } from './Filmstrip';
import type { AssetTypeFilter } from '@/components/layers/AssetBrowserPanel';
import { ToolSettings, ToolSwatches } from './DockControls';
import { RoomsDockTail, SuggestBar } from './RoomsDock';
import { PropsDockTail } from './PropsDock';
import { LightsDockTail } from './LightsDock';
import { targetName, useLookTarget } from './roomLook';

interface DockProps {
  tab: DockTabId;
  onTab: (tab: DockTabId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenLayers: () => void;
  /** Opens one layer's settings sheet; `target` is a layer id or the terrain pseudo-layer. */
  onOpenLayerSettings: (target: string) => void;
  /** Opens the asset browser, on `type`'s tab when given. */
  onOpenAssets: (type?: AssetTypeFilter) => void;
  /** Whether the Sky & mood sheet is open, and the Lights tab's button that opens or closes it. */
  skyOpen?: boolean;
  onToggleSky?: () => void;
}

/**
 * Bottom dock: one quiet strip. The tab row picks a tool family; under it, left to right,
 * the layers (where you draw), the family's tools, its presets, and the few settings that
 * matter for the tool in hand. Nothing in it scrolls up and down.
 */
export const Dock = forwardRef<HTMLDivElement, DockProps>(function Dock(
  { tab, onTab, collapsed, onToggleCollapsed, onOpenLayers, onOpenLayerSettings, onOpenAssets, skyOpen = false, onToggleSky },
  ref,
) {
  const current = DOCK_TABS.find((t) => t.id === tab) ?? DOCK_TABS[0];
  // The Floors and Walls tabs pin on a selected room, area or level instead of the layer.
  const target = useLookTarget();
  const targetLabel = useStore((s) => (target && (tab === 'floors' || tab === 'walls') ? targetName(s, target) : null));
  const layerName = useStore((s) => {
    if (s.ui.activeLayerId === TERRAIN_PANEL_ID) return 'Terrain';
    const layer = s.layers.find((l) => l.id === s.ui.activeLayerId);
    return layer ? layer.name || (layer.type === 'background' ? 'Background' : 'Unnamed layer') : null;
  });

  return (
    <section
      ref={ref}
      className={cn('v2-dock v2-float', collapsed && 'v2-dock--collapsed')}
      data-testid="v2-dock"
      data-keys="canvas"
      data-chrome
      aria-label="Drawing dock"
    >
      <div className="v2-dock__tabs" role="tablist" aria-label="Tool families">
        {DOCK_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={cn('v2-dock__tab', t.id === tab && 'v2-dock__tab--on')}
            data-testid={`v2-dock-tab-${t.id}`}
            onClick={() => {
              onTab(t.id);
              if (collapsed) onToggleCollapsed();
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="v2-dock__spacer" />
        {(targetLabel ?? layerName) && (
          <span className="v2-dock__context" data-testid="v2-dock-context">
            on <b>{targetLabel ?? layerName}</b>
          </span>
        )}
        <button
          type="button"
          className="v2-ib v2-dock__chevron"
          aria-label={collapsed ? 'Expand dock (Tab)' : 'Collapse dock (Tab)'}
          data-tip={collapsed ? 'Expand' : 'Collapse'}
          data-tip-key="Tab"
          aria-expanded={!collapsed}
          data-testid="v2-dock-toggle"
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronUp size={15} strokeWidth={1.75} /> : <ChevronDown size={15} strokeWidth={1.75} />}
        </button>
      </div>

      <SuggestBar />
      {!collapsed && (
        <div className="v2-dock__body">
          <Filmstrip onOpenLayers={onOpenLayers} onOpenLayerSettings={onOpenLayerSettings} mapWide={tab !== 'rooms'} />
          <span className="v2-vr" role="presentation" />
          {tab === 'assets' ? <AssetsStrip onOpenAssets={onOpenAssets} /> : <FamilyStrip tab={current} onTab={onTab} onOpenAssets={onOpenAssets} skyOpen={skyOpen} onToggleSky={onToggleSky} />}
        </div>
      )}
    </section>
  );
});

function pickTool(entry: ToolEntry) {
  const s = useStore.getState();
  if (s.tools.activeTool === entry.tool) return;
  s.setActiveTool(entry.tool);
  notify.subtle(entry.label, { icon: 'tool' });
}

function FamilyStrip({
  tab,
  onTab,
  onOpenAssets,
  skyOpen,
  onToggleSky,
}: {
  tab: DockTab;
  onTab: (tab: DockTabId) => void;
  onOpenAssets: (type?: AssetTypeFilter) => void;
  skyOpen: boolean;
  onToggleSky?: () => void;
}) {
  const activeTool = useStore((s) => s.tools.activeTool);
  // The active tool when it belongs to this tab; otherwise the family's first, which is
  // what the next stroke from this tab will use.
  const tool: ToolType | undefined =
    tabForTool(activeTool) === tab.id && tab.tools.some((t) => t.tool === activeTool)
      ? activeTool
      : tab.tools[0]?.tool;
  if (!tool) return null;

  return (
    <>
      <div className="v2-dock__section" role="toolbar" aria-label={`${tab.label} tools`}>
        {tab.tools.map((entry) => {
          const Icon = entry.icon;
          const on = activeTool === entry.tool;
          return (
            <button
              key={entry.tool}
              type="button"
              className={cn('v2-ib v2-ib--lg', on && 'v2-ib--on')}
              aria-pressed={on}
              aria-label={`${entry.label} (${entry.shortcut})`}
              data-tip={entry.label}
              data-tip-key={entry.shortcut}
              data-testid={`v2-tool-${entry.tool}`}
              onClick={() => pickTool(entry)}
            >
              <Icon size={16} strokeWidth={1.75} />
            </button>
          );
        })}
      </div>
      <Swatches tool={tool} tab={tab.id} onTab={onTab} onOpenAssets={onOpenAssets} />
      <span className="v2-vr" role="presentation" />
      <ToolSettings tool={tool} />
      {tab.id === 'rooms' && <RoomsDockTail />}
      {tab.id === 'props' && <PropsDockTail />}
      {tab.id === 'lights' && onToggleSky && <LightsDockTail skyOpen={skyOpen} onToggleSky={onToggleSky} />}
    </>
  );
}

/** The presets column, with its own divider, only when the tool has presets. */
function Swatches({
  tool,
  tab,
  onTab,
  onOpenAssets,
}: {
  tool: ToolType;
  tab: DockTabId;
  onTab: (t: DockTabId) => void;
  onOpenAssets: (type?: AssetTypeFilter) => void;
}) {
  if (!hasSwatches(tool, tab)) return null;
  return (
    <>
      <span className="v2-vr" role="presentation" />
      <ToolSwatches tool={tool} tab={tab} onTab={onTab} onOpenAssets={onOpenAssets} />
    </>
  );
}

function AssetsStrip({ onOpenAssets }: { onOpenAssets: (type?: AssetTypeFilter) => void }) {
  const picked = useStore((s) => s.tools.settings.scatterBrush.assetIds.length);
  return (
    <div className="v2-dock__section">
      <span className="v2-dock__note">
        {picked === 0 ? 'Pick props for the brush in the props library' : `${picked} prop${picked > 1 ? 's' : ''} picked for the brush`}
      </span>
      <button type="button" className="v2-ib" aria-label="Open props library" data-tip="Props library" onClick={() => onOpenAssets('object')}>
        <PanelRight size={15} strokeWidth={1.75} />
      </button>
    </div>
  );
}
