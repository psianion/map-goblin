import { ContextMenu } from 'map-builder';
import { Copy, Trash2, Lock, Layers } from 'lucide-react';

const noop = () => {};

export function LayerMenu() {
  return (
    <ContextMenu
      pos={{ x: 24, y: 24 }}
      onClose={noop}
      items={[
        {
          type: 'header',
          label: 'Torchlit Corridor',
          sublabel: 'Wall layer · 24 nodes',
          icon: <Layers />,
        },
        { label: 'Duplicate', onSelect: noop, icon: <Copy />, kbd: 'Ctrl+D' },
        { label: 'Lock layer', onSelect: noop, icon: <Lock />, kbd: 'Ctrl+L' },
        { type: 'toggle', label: 'Visible on table', checked: true, onToggle: noop },
        { label: 'Send to back', onSelect: noop, disabled: true },
        {
          label: 'Delete layer',
          onSelect: noop,
          icon: <Trash2 />,
          danger: true,
          separatorBefore: true,
        },
      ]}
    />
  );
}

export function TerrainMenu() {
  return (
    <ContextMenu
      pos={{ x: 24, y: 24 }}
      onClose={noop}
      items={[
        { type: 'header', label: 'Packed earth', sublabel: 'Terrain brush' },
        {
          type: 'slider',
          label: 'Brush size',
          value: 48,
          min: 8,
          max: 128,
          step: 4,
          onChange: noop,
          onCommit: noop,
        },
        {
          type: 'swatches',
          label: 'Tint',
          value: '#6b7f5c',
          options: ['#6b7f5c', '#8a7f5a', '#5c6b7f', '#7f5c6b', '#3f4a38'],
          optionNames: ['Moss', 'Sand', 'Slate', 'Rust', 'Deep moss'],
          onPick: noop,
        },
        { label: 'Reset tint', onSelect: noop, separatorBefore: true },
      ]}
    />
  );
}
