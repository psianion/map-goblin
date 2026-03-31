import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { MapMeta } from '@/store/types';

interface MapCardProps {
  map: MapMeta;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function MapCard({
  map,
  isActive,
  onSwitch,
  onRename,
  onDuplicate,
  onDelete,
}: MapCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(map.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Close context menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== map.name) {
      onRename(map.id, trimmed);
    } else {
      setEditName(map.name);
    }
    setEditing(false);
  }, [editName, map.id, map.name, onRename]);

  const handleClick = () => {
    if (!isActive && !editing) {
      onSwitch(map.id);
    }
  };

  const handleDoubleClick = () => {
    setEditName(map.name);
    setEditing(true);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      setEditName(map.name);
      setEditing(false);
    }
  };

  const handleMenuAction = (action: 'rename' | 'duplicate' | 'delete') => {
    setMenuOpen(false);
    if (action === 'rename') {
      setEditName(map.name);
      setEditing(true);
    } else if (action === 'duplicate') {
      onDuplicate(map.id);
    } else if (action === 'delete') {
      onDelete(map.id);
    }
  };

  const meta = `${map.gridSize.width}\u00D7${map.gridSize.height} \u00B7 ${map.layerCount} layer${map.layerCount !== 1 ? 's' : ''} \u00B7 ${timeAgo(map.updatedAt)}`;

  return (
    <div
      data-testid="map-card"
      className={cn(
        'relative px-3 py-2.5 rounded-lg border cursor-pointer transition-colors',
        isActive
          ? 'bg-surface-2 border-accent-active/30'
          : 'bg-transparent border-border-default hover:bg-surface-1',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Active badge */}
      {isActive && (
        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-accent-active/15 text-accent-active border border-accent-active/25 rounded">
          Editing
        </span>
      )}

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          className="w-full bg-surface-0 border border-border-default rounded px-1 py-0.5 text-sm font-medium text-text-primary outline-none focus:border-accent-active"
        />
      ) : (
        <div className="text-sm font-medium text-text-primary truncate pr-14">
          {map.name}
        </div>
      )}

      {/* Meta line */}
      <div className="text-xs text-text-muted mt-0.5 font-mono">
        {meta}
      </div>

      {/* Context menu (right-click or more button) */}
      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[140px] bg-surface-1 border border-border-default rounded-md shadow-lg py-1"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            type="button"
            onClick={() => handleMenuAction('rename')}
            className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-2 transition-colors"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => handleMenuAction('duplicate')}
            className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-2 transition-colors"
          >
            Duplicate
          </button>
          <div className="h-px bg-border-default mx-2 my-1" />
          <button
            type="button"
            onClick={() => handleMenuAction('delete')}
            className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-surface-2 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
