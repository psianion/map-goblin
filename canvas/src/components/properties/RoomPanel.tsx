import { useState } from 'react'
import { DoorOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/store/store'
import { CollapsibleSection } from '@/components/ui/collapsible-section'
import { ToggleSwitch } from '@/components/ui/toggle-switch'
import { RenameRoomCommand } from '@/store/commands'
import { seedRoomsFromDetection } from '@dnd/core/src/store/seedRooms'
import { undoManager } from '@/store/undoManager'
import { notify } from '@/lib/toast'
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
  const overlayVisible = useStore((s) => s.ui.roomOverlayVisible)
  const setOverlayVisible = useStore((s) => s.setRoomOverlayVisible)
  // Once the layer holds drawn rooms it IS the room source, so seeding from
  // detection would only clone what is already there — seedRoomsFromDetection
  // no-ops, and the affordance goes with it.
  const hasAuthoredRooms = useStore((s) => {
    const l = s.layers.find((x) => x.id === layer.id)
    return l?.type === 'dungeon' ? l.children.some((c) => c.childType === 'room') : false
  })

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
      // Same header affordance the Grid section uses for its own ink, and it means
      // the same thing: show the drawn loops and joints or don't. The room and
      // door tools override it while they are held.
      headerExtra={
        <ToggleSwitch
          checked={overlayVisible}
          onChange={setOverlayVisible}
          label="Show room outlines"
        />
      }
    >
      {rooms.length === 0 ? (
        <p className="py-1 text-panel-body text-text-muted">
          No rooms yet — draw one with the Room tool (O), or draw walls that enclose part of
          the floor.
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
      {!hasAuthoredRooms && rooms.length > 0 && (
        <button
          type="button"
          // The list reads the same before and after — same names, same count — so the
          // button vanishing was the only sign anything happened. Say what happened.
          onClick={() => {
            const count = seedRoomsFromDetection(layer.id)
            if (count > 0) notify.success(`Made ${count} room${count === 1 ? '' : 's'} editable`)
          }}
          className="mt-2 w-full rounded border border-border-default bg-surface-1 px-2 py-1 text-panel-body text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
        >
          Make rooms editable
        </button>
      )}
    </CollapsibleSection>
  )
}
