import { PublishDialog } from 'map-builder';

const noop = () => {};

// Publishes the current map to a live table and hands back an invite code.
export function Open() {
  return <PublishDialog open onOpenChange={noop} />;
}
