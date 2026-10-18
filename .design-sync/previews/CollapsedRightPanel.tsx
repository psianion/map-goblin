import { CollapsedRightPanel } from 'map-builder';

const noop = () => {};

// The rail the right dock becomes when collapsed — icon shortcuts that expand
// straight back to a named section.
export function Default() {
  return (
    <div className="inline-flex h-[520px] overflow-hidden rounded-lg border border-border">
      <CollapsedRightPanel onExpand={noop} />
    </div>
  );
}
