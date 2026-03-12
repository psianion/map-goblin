import { useState, useEffect, useCallback } from 'react';
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
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '@/store/store';
import type { ToolType } from '@/store/types';
import { TOOLS_WITH_POPOVER, togglePopoverRef } from './toolConstants';
import { ToolPopover } from './ToolPopover';

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

/** Module-level button element map — avoids useRef reads during render */
const toolButtonElements = new Map<ToolType, HTMLButtonElement>();

function getButtonTop(tool: ToolType): number {
  const btn = toolButtonElements.get(tool);
  return btn ? btn.getBoundingClientRect().top : 0;
}

export function LeftToolbar() {
  const activeTool = useStore((s) => s.tools.activeTool);
  const eraseMode = useStore((s) => s.tools.eraseMode);
  const roughMode = useStore((s) => s.tools.roughMode);
  const setActiveTool = useStore((s) => s.setActiveTool);
  const setEraseMode = useStore((s) => s.setEraseMode);
  const setRoughMode = useStore((s) => s.setRoughMode);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverTool, setPopoverTool] = useState<ToolType | null>(null);
  const [popoverAnchorY, setPopoverAnchorY] = useState(0);

  const openPopover = useCallback((tool: ToolType) => {
    setPopoverAnchorY(getButtonTop(tool));
    setPopoverTool(tool);
    setPopoverOpen(true);
  }, []);

  const closePopover = useCallback(() => {
    setPopoverOpen(false);
  }, []);

  const togglePopover = useCallback(() => {
    if (popoverOpen) {
      closePopover();
    } else if (activeTool && TOOLS_WITH_POPOVER.has(activeTool)) {
      openPopover(activeTool);
    }
  }, [popoverOpen, activeTool, closePopover, openPopover]);

  // Register toggle ref for keyboard shortcut access
  useEffect(() => {
    togglePopoverRef.current = togglePopover;
    return () => {
      togglePopoverRef.current = null;
    };
  }, [togglePopover]);

  // Auto-open/close popover when active tool changes
  // React-recommended "adjusting state during render" pattern — no effect needed
  const [prevActiveTool, setPrevActiveTool] = useState(activeTool);
  if (prevActiveTool !== activeTool) {
    setPrevActiveTool(activeTool);
    if (TOOLS_WITH_POPOVER.has(activeTool)) {
      setPopoverTool(activeTool);
      setPopoverAnchorY(getButtonTop(activeTool));
      setPopoverOpen(true);
    } else {
      setPopoverOpen(false);
    }
  }

  const handleToolClick = (tool: ToolType) => {
    if (activeTool === tool) {
      // Toggle popover if already active
      if (TOOLS_WITH_POPOVER.has(tool)) {
        if (popoverOpen) {
          closePopover();
        } else {
          openPopover(tool);
        }
      }
    } else {
      setActiveTool(tool);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
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
        const hasPopover = TOOLS_WITH_POPOVER.has(tool);
        return (
          <button
            key={tool}
            data-toolbar-button
            ref={(el) => {
              if (el) toolButtonElements.set(tool, el);
              else toolButtonElements.delete(tool);
            }}
            title={shortcut ? `${label} (${shortcut})` : label}
            onClick={() => handleToolClick(tool)}
            style={{
              position: 'relative',
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
            {hasPopover && active && (
              <ChevronRight
                size={8}
                style={{
                  position: 'absolute',
                  bottom: 3,
                  right: 3,
                  opacity: 0.7,
                }}
              />
            )}
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
        data-toolbar-button
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
        data-toolbar-button
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

      {/* Tool Popover */}
      {popoverOpen && popoverTool && (
        <ToolPopover
          tool={popoverTool}
          anchorY={popoverAnchorY}
          onClose={closePopover}
        />
      )}
    </div>
  );
}
