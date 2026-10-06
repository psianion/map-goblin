import { LeftPanel } from 'map-builder';

// The whole left dock — tool rail plus the active side panel. Store-driven and
// propless, so this is the real first-run composition.
export function Default() {
  return (
    <div className="h-[560px] overflow-hidden rounded-lg border border-border">
      <LeftPanel />
    </div>
  );
}
