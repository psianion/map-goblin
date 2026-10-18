import { ExportDialog } from 'map-builder';

const noop = () => {};

// Export options for the current map; all of its state comes from the store.
export function Open() {
  return <ExportDialog open onOpenChange={noop} />;
}
