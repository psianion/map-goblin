import { ColorChip } from 'map-builder';

const PALETTE = ['#6b7f5c', '#8a7f5a', '#5c6b7f', '#7f5c6b', '#3f4a38', '#c8a45c'];

export function Sizes() {
  return (
    <div className="flex items-center gap-3">
      <ColorChip color="#6b7f5c" size="preview" />
      <ColorChip color="#6b7f5c" size="sm" />
      <ColorChip color="#6b7f5c" size="md" />
    </div>
  );
}

export function Circular() {
  return (
    <div className="flex items-center gap-3">
      <ColorChip color="#8a7f5a" size="md" circular />
      <ColorChip color="#5c6b7f" size="md" circular />
      <ColorChip color="#7f5c6b" size="md" circular />
    </div>
  );
}

export function Palette() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map((c) => (
        <ColorChip key={c} color={c} size="md" />
      ))}
    </div>
  );
}
