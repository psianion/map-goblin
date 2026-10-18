import { InlineEditableName } from 'map-builder';

const noop = () => {};

// Used for layer and map names — click (or F2) to edit in place.
export function Display() {
  return (
    <div className="w-[260px]">
      <InlineEditableName
        value="Torchlit Corridor"
        editing={false}
        onStartEdit={noop}
        onCommit={noop}
        onCancel={noop}
      />
    </div>
  );
}

export function Editing() {
  return (
    <div className="w-[260px]">
      <InlineEditableName
        value="Torchlit Corridor"
        editing
        onStartEdit={noop}
        onCommit={noop}
        onCancel={noop}
      />
    </div>
  );
}
