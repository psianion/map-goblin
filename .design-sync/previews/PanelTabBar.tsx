import { PanelTabBar } from 'map-builder';

const noop = () => {};

export function MapsActive() {
  return (
    <div className="w-[300px]">
      <PanelTabBar activeTab="maps" onTabChange={noop} />
    </div>
  );
}

export function ScenesActive() {
  return (
    <div className="w-[300px]">
      <PanelTabBar activeTab="scenes" onTabChange={noop} />
    </div>
  );
}
