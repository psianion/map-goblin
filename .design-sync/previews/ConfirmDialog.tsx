import { ConfirmDialog } from 'map-builder';

const noop = () => {};

export function Destructive() {
  return (
    <ConfirmDialog
      open
      onOpenChange={noop}
      title="Delete “Warren Clearing”?"
      message="This removes the map and every layer on it. Sessions already run from it keep their history."
      confirmLabel="Delete map"
      destructive
      onConfirm={noop}
    />
  );
}

export function Neutral() {
  return (
    <ConfirmDialog
      open
      onOpenChange={noop}
      title="Publish to the table?"
      message="Players at the table will see this version of the map immediately."
      confirmLabel="Publish"
      cancelLabel="Not yet"
      onConfirm={noop}
    />
  );
}
