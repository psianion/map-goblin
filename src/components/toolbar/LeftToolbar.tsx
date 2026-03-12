import {
  MousePointer2,
  Hand,
  Square,
  Pentagon,
  Hexagon,
  Pen,
  Minus,
  Lightbulb,
  Eraser,
  Waves,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '@/store/store';
import type { ToolType } from '@/store/types';

interface ToolButton {
  tool: ToolType;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const TOOLS: ToolButton[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { tool: 'pan', icon: Hand, label: 'Pan', shortcut: 'G' },
  { tool: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'R' },
  { tool: 'polygon', icon: Pentagon, label: 'Polygon', shortcut: 'P' },
  { tool: 'regularPolygon', icon: Hexagon, label: 'Regular Polygon', shortcut: 'H' },
  { tool: 'path', icon: Pen, label: 'Path', shortcut: 'D' },
  { tool: 'wall', icon: Minus, label: 'Wall', shortcut: 'W' },
  { tool: 'light', icon: Lightbulb, label: 'Light', shortcut: 'L' },
];

export function LeftToolbar() {
  const activeTool = useStore((s) => s.tools.activeTool);
  const eraseMode = useStore((s) => s.tools.eraseMode);
  const roughMode = useStore((s) => s.tools.roughMode);
  const setActiveTool = useStore((s) => s.setActiveTool);
  const setEraseMode = useStore((s) => s.setEraseMode);
  const setRoughMode = useStore((s) => s.setRoughMode);

  return (
    <div
      style={{
        width: 48,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 8,
        gap: 2,
        background: 'var(--color-surface-1, #1a1a1a)',
        borderRight: '1px solid var(--color-border, #2a2a2a)',
        flexShrink: 0,
      }}
    >
      {TOOLS.map(({ tool, icon: Icon, label, shortcut }) => {
        const active = activeTool === tool;
        return (
          <button
            key={tool}
            title={shortcut ? `${label} (${shortcut})` : label}
            onClick={() => setActiveTool(tool)}
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--color-accent, #4f8ef7)' : 'transparent',
              color: active ? '#fff' : 'var(--color-text-muted, #888)',
              flexShrink: 0,
              transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'var(--color-surface-2, #2a2a2a)';
                (e.currentTarget as HTMLButtonElement).style.color = '#ccc';
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color =
                  'var(--color-text-muted, #888)';
              }
            }}
          >
            <Icon size={18} strokeWidth={1.75} />
          </button>
        );
      })}

      {/* Divider */}
      <div
        style={{
          width: 28,
          height: 1,
          background: 'var(--color-border, #2a2a2a)',
          margin: '4px 0',
          flexShrink: 0,
        }}
      />

      {/* Erase mode toggle */}
      <button
        title="Erase mode (E)"
        onClick={() => setEraseMode(!eraseMode)}
        style={{
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          background: eraseMode ? '#c0392b' : 'transparent',
          color: eraseMode ? '#fff' : 'var(--color-text-muted, #888)',
          flexShrink: 0,
          transition: 'background 120ms, color 120ms',
        }}
        onMouseEnter={(e) => {
          if (!eraseMode) {
            (e.currentTarget as HTMLButtonElement).style.background =
              'var(--color-surface-2, #2a2a2a)';
            (e.currentTarget as HTMLButtonElement).style.color = '#ccc';
          }
        }}
        onMouseLeave={(e) => {
          if (!eraseMode) {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color =
              'var(--color-text-muted, #888)';
          }
        }}
      >
        <Eraser size={18} strokeWidth={1.75} />
      </button>

      {/* Rough mode toggle */}
      <button
        title="Rough mode (X)"
        onClick={() => setRoughMode(!roughMode)}
        style={{
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          background: roughMode ? 'var(--color-accent, #4f8ef7)' : 'transparent',
          color: roughMode ? '#fff' : 'var(--color-text-muted, #888)',
          flexShrink: 0,
          transition: 'background 120ms, color 120ms',
        }}
        onMouseEnter={(e) => {
          if (!roughMode) {
            (e.currentTarget as HTMLButtonElement).style.background =
              'var(--color-surface-2, #2a2a2a)';
            (e.currentTarget as HTMLButtonElement).style.color = '#ccc';
          }
        }}
        onMouseLeave={(e) => {
          if (!roughMode) {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color =
              'var(--color-text-muted, #888)';
          }
        }}
      >
        <Waves size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}
