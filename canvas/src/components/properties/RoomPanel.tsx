import { useState } from 'react'
import { DoorOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/store/store'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { RenameRoomCommand } from '@/store/commands'
import { undoManager } from '@/store/undoManager'
import type { DungeonLayer, Room } from '@/store/types'

interface RoomPanelProps {
  layer: DungeonLayer
  openSections?: Set<string>
  onToggleSection?: (id: string) => void
}

/** Rooms detected from the layer's floor + walls. Read-only apart from names. */
export function RoomPanel({ layer, openSections, onToggleSection }: RoomPanelProps) {
  const rooms = useStore(useShallow((s) => {
    const l = s.layers.find((x) => x.id === layer.id)
    return l?.type === 'dungeon' ? (l.rooms ?? []) : []
  }))
  const setHighlightedRoomId = useStore((s) => s.setHighlightedRoomId)

  // Pinned = clicked; the canvas highlight falls back to it when hover ends.
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startRename = (room: Room) => {
    setEditingId(room.id)
    setDraft(room.name)
  }

  const commitRename = (room: Room) => {
    const name = draft.trim()
    if (name && name !== room.name) {
      undoManager.execute(new RenameRoomCommand(layer.id, room.id, room.name, name))
    }
    setEditingId(null)
  }

  return (
    <CollapsibleSection
      id="rooms"
      title={`Rooms (${rooms.length})`}
      icon={DoorOpen}
      isOpen={openSections?.has('rooms')}
      onToggle={onToggleSection}
    >
      {rooms.length === 0 ? (
        <p className="py-1 text-panel-body text-text-muted">
          No rooms yet — draw walls that enclose part of the floor.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 pt-1">
          {rooms.map((room) => (
            <li
              key={room.id}
              onMouseEnter={() => setHighlightedRoomId(room.id)}
              onMouseLeave={() => setHighlightedRoomId(pinnedId)}
              className={`flex items-center gap-2 rounded px-2 py-1 text-panel-body transition-colors ${
                pinnedId === room.id ? 'bg-surface-3' : 'hover:bg-surface-3'
              }`}
            >
              {editingId === room.id ? (
                <input
                  autoFocus
                  aria-label={`Rename ${room.name}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(room)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(room)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="min-w-0 flex-1 rounded border border-border-default bg-surface-1 px-1 text-text-primary outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPinnedId(room.id)
                    setHighlightedRoomId(room.id)
                  }}
                  onDoubleClick={() => startRename(room)}
                  className="min-w-0 flex-1 truncate text-left text-text-primary"
                >
                  {room.name}
                </button>
              )}
              {room.isPathway && (
                <span className="shrink-0 rounded bg-surface-1 px-1 font-mono text-panel-label uppercase text-text-muted">
                  pathway
                </span>
              )}
              <span className="shrink-0 font-mono text-panel-label text-text-muted">
                {Math.round(room.area)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  )
}
