// Canvas context-menu contribution registry.
//
// One menu anatomy for every child kind: identity header → type quick-controls
// → type verbs → shared verbs → danger. Each kind registers a builder that
// returns typed rows; the renderer (context-menu.tsx) switches on row type and
// never on what the menu is for, so a new child kind means a new builder here
// and nothing else.

import type { MenuRow, MenuSubmenuRow } from '@/components/ui/context-menu'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import {
  CompositeCommand,
  UpdateChildCommand,
  createRemoveFromGroupCommand,
  createDeleteGroupCommand,
  createDuplicateGroupCommand,
  AddAreaCommand,
  AssignRoomsToAreaCommand,
  MergeRoomsCommand,
  RemoveAreaCommand,
  RemoveRoomCommand,
  RenameAreaCommand,
  RenameRoomCommand,
} from '@/store/commands'
import type {
  AnyChild,
  AssetChild,
  DoorChild,
  DoorStyle,
  DungeonLayer,
  LightChild,
  Room,
  RoomArea,
  WallSegment,
} from '@/store/types'
import { seedDivideStart } from '@dnd/core/src/engine/tools/DivideTool'
import { childGroupOf, groupMembers } from '@/store/selectors'
import { standaloneWallLook } from '@dnd/core/src/shared/wallLook'
import { wallSetLabel } from '@/v2/editor/assetStrip'
import {
  canGroupSelection,
  groupSelection,
  mergeSelection,
  selectionGroup,
  ungroupSelection,
} from './groupActions'
import {
  familyMembers,
  getCatalogEntry,
  propEntries,
  type CatalogEntry,
} from '@dnd/core/src/assets/packCatalog'
import {
  createAlignCommand,
  createDistributeCommand,
  createDuplicateCommand,
  createMoveToLayerCommand,
  createSetPropFieldsCommand,
  createSwapPropCommand,
  createZOrderCommand,
  type AlignEdge,
  type ZOrderOp,
} from '@dnd/core/src/store/propEdits'
import { propField } from '@dnd/core/src/shared/propFields'
import { LIGHT_PRESETS, LIGHT_RADIUS_FT } from '@/v2/editor/lightWrites'
import { clampDoorWidth } from '@dnd/core/src/engine/tools/DoorTool'
import { doorOpeningLimitOn } from '@dnd/core/src/shared/wallResolve'
import { doorwayRoom } from '@dnd/core/src/shared/doorwaySeal'
import { doorwayEditCommand } from '@dnd/core/src/store/doorwayCommands'
import { handleShortcut, isV2Route, rotateSelection90 } from '@/shortcuts/defaultShortcuts'
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef'
import { notify } from '@/lib/toast'

export interface ChildMenuContext {
  layer: DungeonLayer
  child: AnyChild
  /** Current selection — the child is always part of it by the time a menu opens. */
  selectedIds: string[]
  /** Where the right-click landed, in world squares. */
  world: { x: number; y: number }
}

type ChildMenuBuilder = (ctx: ChildMenuContext) => MenuRow[]

const builders = new Map<string, ChildMenuBuilder>()

/** Register (or replace) the quick-controls + verbs builder for a child kind. */
export function registerMenu(kind: string, builder: ChildMenuBuilder): void {
  builders.set(kind, builder)
}

// ─── Shared pieces ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  shape: 'Shape',
  water: 'Water',
  asset: 'Prop',
  text: 'Label',
  light: 'Light',
  door: 'Door',
  zone: 'Zone',
}

function headerRow(child: AnyChild): MenuRow {
  return {
    type: 'header',
    label: child.name || KIND_LABEL[child.childType] || child.childType,
    sublabel: KIND_LABEL[child.childType] ?? child.childType,
  }
}

/** One undoable field edit on a child. */
function commitChild(
  label: string,
  layerId: string,
  childId: string,
  before: Partial<AnyChild>,
  after: Partial<AnyChild>,
): void {
  undoManager.execute(new UpdateChildCommand(label, layerId, childId, before, after))
}

/**
 * Move the current selection to another dungeon layer, one undo entry: walls with
 * their doors, props with their attached lights, a whole group with its record.
 */
function moveSelectionToLayer(targetLayerId: string): void {
  const cmd = createMoveToLayerCommand(useStore.getState().selection.selectedIds, targetLayerId)
  if (cmd) undoManager.execute(cmd)
}

/**
 * Move to layer ▸: the layers of the level being shown, never another level's (moving
 * there would carry the selection out of view and switch the level under the DM). The
 * layer the selection is on is listed greyed; with no other layer on the level, one
 * greyed row says so.
 */
function moveToLayerRow(currentLayerId: string | null, extra: Partial<MenuSubmenuRow> = {}): MenuRow {
  const store = useStore.getState()
  const onLevel = store.layers.filter(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.levelId === store.ui.activeLevelId,
  )
  const targets = onLevel.filter((l) => l.id !== currentLayerId && !l.locked)
  const rows: MenuRow[] =
    targets.length === 0
      ? [{ label: 'No other layer on this level', disabled: true, onSelect: () => {} }]
      : onLevel
          .filter((l) => l.id === currentLayerId || !l.locked)
          .map((l) => ({
            label: l.name,
            disabled: l.id === currentLayerId,
            onSelect: () => moveSelectionToLayer(l.id),
          }))
  return { ...extra, type: 'submenu', label: 'Move to layer', rows }
}

/** Run a prop command when there is one to run (the factories return null for a no-op). */
function run(cmd: ReturnType<typeof createZOrderCommand>): void {
  if (cmd) undoManager.execute(cmd)
}

/**
 * How the menu asks the v2 editor to open the props library in replace mode for these
 * props. The editor installs it; without one, Replace from library is not offered.
 */
export const openPropBrowserRef: { current: ((replaceIds: string[]) => void) | null } = { current: null }

const ORDER_ROWS: { op: ZOrderOp; label: string; kbd: string }[] = [
  { op: 'front', label: 'Bring to front', kbd: 'Ctrl+Shift+]' },
  { op: 'forward', label: 'Bring forward', kbd: 'Ctrl+]' },
  { op: 'backward', label: 'Send backward', kbd: 'Ctrl+[' },
  { op: 'back', label: 'Send to back', kbd: 'Ctrl+Shift+[' },
]

const ALIGN_ROWS: { edge: AlignEdge; label: string }[] = [
  { edge: 'left', label: 'Left edges' },
  { edge: 'hcenter', label: 'Centres, across' },
  { edge: 'right', label: 'Right edges' },
  { edge: 'top', label: 'Top edges' },
  { edge: 'vcenter', label: 'Centres, down' },
  { edge: 'bottom', label: 'Bottom edges' },
]

/** Order ▸ for `ids`: front, forward, backward, back. */
function orderRow(ids: string[]): MenuRow {
  return {
    type: 'submenu',
    label: 'Order',
    separatorBefore: true,
    rows: ORDER_ROWS.map(({ op, label, kbd }) => ({
      label,
      kbd,
      onSelect: () => run(createZOrderCommand(ids, op)),
    })),
  }
}

/** Grid area of a catalogue entry ('2x1' → 2), for the nearest-size fallback. */
function gridArea(e: CatalogEntry): number {
  const [w, h] = e.gridSize.split('x').map(Number)
  return (w || 1) * (h || 1)
}

/**
 * What the Swap strip offers: the prop's family (same footprint first), or, for a prop
 * alone in its family, the props of its set nearest its size. At most eight.
 */
function swapChoices(entry: CatalogEntry): { items: CatalogEntry[]; family: boolean } {
  const family = familyMembers(entry.id)
  if (family.length > 1) return { items: family.slice(0, 8), family: true }
  const area = gridArea(entry)
  const set = propEntries()
    .filter((e) => e.set === entry.set)
    .sort((a, b) => Math.abs(gridArea(a) - area) - Math.abs(gridArea(b) - area))
  const items = [entry, ...set.filter((e) => e.id !== entry.id)].slice(0, 8)
  return { items, family: false }
}

/** A locked prop's whole menu: what it is, and the way back. */
function lockedPropRows(child: AssetChild): MenuRow[] {
  return [
    { type: 'header', label: child.name || 'Prop', sublabel: 'Prop · locked' },
    {
      label: 'Unlock',
      onSelect: () => run(createSetPropFieldsCommand([child.id], { locked: false })),
    },
  ]
}

/**
 * Verbs every child menu ends with. The danger slot (Delete) stays last —
 * the eye finds it in the same place in every menu.
 */
function sharedVerbs(ctx: ChildMenuContext): MenuRow[] {
  const rows: MenuRow[] = [
    {
      separatorBefore: true,
      label: 'Duplicate',
      kbd: 'Ctrl+D',
      onSelect: () => handleShortcut('ctrl+d'),
    },
  ]
  rows.push(moveToLayerRow(ctx.layer.id))
  rows.push({
    separatorBefore: true,
    label: 'Delete',
    danger: true,
    kbd: 'Del',
    onSelect: () => handleShortcut('delete'),
  })
  return rows
}

/**
 * Group verbs, shared by the single-child and multi-selection menus. Pass the
 * right-clicked child's context for the single-child menu; omit it for a
 * multi-selection.
 */
function groupRows(ctx?: ChildMenuContext): MenuRow[] {
  const rows: MenuRow[] = []
  const sameGroup = selectionGroup()
  const ids = useStore.getState().selection.selectedIds
  // "In the same group" is not "is the whole group" — a lone member picked
  // through its group must not offer to delete its siblings.
  const isWholeGroup =
    !!sameGroup &&
    groupMembers(sameGroup.layer, sameGroup.group.id).every((c) => ids.includes(c.id))

  if (ctx?.child.groupId) {
    const { layer, child } = ctx
    const group = childGroupOf(layer, child.id)
    rows.push({
      separatorBefore: true,
      label: 'Remove from group',
      onSelect: () => {
        const cmd = createRemoveFromGroupCommand(useStore.getState().layers, layer.id, [child.id])
        if (cmd) undoManager.execute(cmd)
      },
    })
    if (group && !group.merged) {
      rows.push({
        label: 'Select group',
        onSelect: () =>
          useStore.getState().setSelectedIds(groupMembers(layer, group.id).map((c) => c.id)),
      })
    }
  } else if (sameGroup) {
    rows.push({
      separatorBefore: true,
      label: sameGroup.group.merged ? 'Unmerge' : 'Ungroup',
      kbd: 'Ctrl+Shift+G',
      onSelect: () => ungroupSelection(),
    })
  } else if (canGroupSelection()) {
    rows.push(
      { separatorBefore: true, label: 'Group selection', kbd: 'Ctrl+G', onSelect: () => groupSelection() },
      { label: 'Merge selection', onSelect: () => mergeSelection() },
    )
  }

  if (sameGroup && isWholeGroup) {
    const { layer, group } = sameGroup
    rows.push(
      {
        label: 'Duplicate group',
        onSelect: () => {
          const cmd = createDuplicateGroupCommand(useStore.getState().layers, layer.id, group.id)
          if (cmd) undoManager.execute(cmd)
        },
      },
      {
        label: 'Delete group',
        danger: true,
        onSelect: () => {
          const cmd = createDeleteGroupCommand(useStore.getState().layers, layer.id, group.id)
          if (cmd) undoManager.execute(cmd)
        },
      },
    )
  }
  return rows
}

/** Splice the group verbs in above the danger slot, which stays last. */
function withGroupRows(rows: MenuRow[], ctx?: ChildMenuContext): MenuRow[] {
  const extra = groupRows(ctx)
  if (extra.length === 0) return rows
  const at = rows.findIndex((r) => (r as { danger?: boolean }).danger)
  return at < 0 ? [...rows, ...extra] : [...rows.slice(0, at), ...extra, ...rows.slice(at)]
}

// ─── Per-kind builders ─────────────────────────────────────────────────────

registerMenu('asset', (ctx) => {
  const child = ctx.child
  if (child.childType !== 'asset') return []
  const rows: MenuRow[] = [headerRow(child)]
  const v2 = isV2Route()

  // Swap strip: the prop's variants, kept in its footprint. Imported images have
  // no catalog entry — the strip simply doesn't appear for them rather than
  // showing an empty shelf. Empty `src` makes MenuThumb render the pack
  // texture via PackThumbnailCanvas.
  const entry = getCatalogEntry(child.assetId)
  if (entry) {
    const { items, family } = swapChoices(entry)
    if (items.length > 1) {
      rows.push({
        type: 'thumbStrip',
        label: family ? 'Swap · same family, same footprint' : 'Swap · same set, same footprint',
        closeOnPick: true,
        items: items.map((n) => ({
          id: n.id,
          src: '',
          title: n.label,
          active: n.id === child.assetId,
        })),
        onPick: (id) => {
          if (id === child.assetId) return
          run(createSwapPropCommand([child.id], id, 'footprint'))
        },
      })
    }
  }
  if (v2 && openPropBrowserRef.current) {
    rows.push({
      label: 'Replace from library…',
      onSelect: () => openPropBrowserRef.current?.([child.id]),
    })
  }

  rows.push(
    {
      separatorBefore: true,
      label: 'Flip horizontal',
      kbd: 'Shift+H',
      onSelect: () => handleShortcut('shift+h'),
    },
    { label: 'Flip vertical', kbd: 'Shift+V', onSelect: () => handleShortcut('shift+v') },
    { label: 'Rotate 90°', onSelect: () => rotateSelection90() },
  )
  if (v2) {
    rows.push(
      orderRow([child.id]),
      {
        type: 'toggle',
        label: 'Overhead',
        look: 'check',
        checked: propField(child, 'overhead'),
        onToggle: (next) => run(createSetPropFieldsCommand([child.id], { overhead: next })),
      },
      {
        type: 'toggle',
        label: 'Glows',
        look: 'check',
        checked: propField(child, 'glows'),
        onToggle: (next) => run(createSetPropFieldsCommand([child.id], { glows: next })),
      },
      {
        type: 'toggle',
        label: 'Blocks light',
        look: 'check',
        checked: propField(child, 'blocksLight'),
        onToggle: (next) => run(createSetPropFieldsCommand([child.id], { blocksLight: next })),
      },
      { label: 'Lock', onSelect: () => run(createSetPropFieldsCommand([child.id], { locked: true })) },
    )
  }
  return [...rows, ...sharedVerbs(ctx)]
})

// The presets' colours (darkness has none), named for a screen reader.
const LIGHT_COLOURS = LIGHT_PRESETS.filter((p) => !p.darkness)

registerMenu('light', (ctx) => {
  const child = ctx.child
  if (child.childType !== 'light') return []
  const layerId = ctx.layer.id
  const patch = (p: Partial<LightChild>) => useStore.getState().updateChild(layerId, child.id, p)
  // Bright and dim in feet on the card's one range; bright never passes dim, so a drag on
  // either can carry the other, and the step it lands records both.
  const ftPerCell = useStore.getState().mapSettings.cellScale.value || 5
  let base = { featherRadius: child.featherRadius, radius: child.radius }
  const reach = (which: 'bright' | 'dim', ft: number): Partial<LightChild> => {
    const cells = ft / ftPerCell
    const cur = useStore.getState().layers.find((l) => l.id === layerId)
    const live = (cur as DungeonLayer | undefined)?.children.find((c) => c.id === child.id) as LightChild | undefined
    const dim = live?.radius ?? child.radius
    const bright = live?.featherRadius ?? child.featherRadius
    if (which === 'bright') return cells > dim ? { featherRadius: cells, radius: cells } : { featherRadius: cells }
    return cells < bright ? { radius: cells, featherRadius: cells } : { radius: cells }
  }
  const commitReach = (label: string, which: 'bright' | 'dim', ft: number) => {
    const before = base
    // The store holds the drag's end; the step records it from where the drag began.
    patch(before)
    const after = { ...before, ...reach(which, ft) }
    base = after
    commitChild(label, layerId, child.id, before, after)
  }
  const rows: MenuRow[] = [
    headerRow(child),
    {
      type: 'slider',
      label: 'Bright (ft)',
      value: Math.round(child.featherRadius * ftPerCell),
      ...LIGHT_RADIUS_FT,
      onChange: (v) => patch(reach('bright', v)),
      onCommit: (next) => commitReach('Light bright', 'bright', next),
    },
    {
      type: 'slider',
      label: 'Dim (ft)',
      value: Math.round(child.radius * ftPerCell),
      ...LIGHT_RADIUS_FT,
      onChange: (v) => patch(reach('dim', v)),
      onCommit: (next) => commitReach('Light dim', 'dim', next),
    },
    {
      type: 'slider',
      label: 'Intensity',
      value: child.intensity,
      min: 0,
      max: 1,
      step: 0.05,
      onChange: (v) => patch({ intensity: v }),
      onCommit: (next, start) =>
        commitChild('Light intensity', layerId, child.id, { intensity: start }, { intensity: next }),
    },
  ]
  // A darkness source has no colour to pick.
  if (!child.darkness) {
    rows.push({
      type: 'swatches',
      label: 'Colour',
      value: child.color,
      options: LIGHT_COLOURS.map((p) => p.color),
      optionNames: LIGHT_COLOURS.map((p) => p.label),
      onPick: (color) =>
        commitChild('Light colour', layerId, child.id, { color: child.color }, { color }),
    })
  }
  return [...rows, ...sharedVerbs(ctx)]
})

const DOOR_STYLES: { value: DoorStyle; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'portcullis', label: 'Portcullis' },
  { value: 'archway', label: 'Archway' },
  { value: 'portal', label: 'Portal' },
]

registerMenu('door', (ctx) => {
  const child = ctx.child
  if (child.childType !== 'door') return []
  const layerId = ctx.layer.id
  const setState = (state: DoorChild['state']) =>
    commitChild('Door state', layerId, child.id, { state: child.state }, { state })
  const rows: MenuRow[] = [
    headerRow(child),
    child.state === 'open'
      ? { label: 'Close', onSelect: () => setState('closed') }
      : { label: 'Open', onSelect: () => setState('open') },
    child.state === 'locked'
      ? { label: 'Unlock', onSelect: () => setState('closed') }
      : { label: 'Lock', onSelect: () => setState('locked') },
    {
      type: 'toggle',
      label: 'Secret',
      checked: child.isSecret,
      onToggle: (next) =>
        commitChild('Door secret', layerId, child.id, { isSecret: child.isSecret }, { isSecret: next }),
    },
    {
      type: 'submenu',
      label: 'Style',
      rows: DOOR_STYLES.map((s) => ({
        label: s.label,
        // A real checked state, not ' ✓' pasted into the label — the row
        // announces as one choice of a set and draws the glyph itself.
        checked: child.style === s.value,
        // The width follows the style, as in the selection card: a double needs room
        // for two leaves, and no width may overhang the room the opening has (its wall,
        // or the straight run of walls it sits in).
        // In a doorway the walls either side follow the new width, in the same undo step.
        onSelect: () => {
          const layer = (useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer | undefined) ?? ctx.layer
          const room = doorwayRoom(layer, child.id) ?? doorOpeningLimitOn(layer, child.id)
          const width = clampDoorWidth(child.width, s.value, room)
          const cmd = doorwayEditCommand('Door style', layer, child.id, { style: child.style }, { style: s.value }, { width })
          if (cmd) undoManager.execute(cmd)
        },
      })),
    },
  ]
  // Doors are wall-bound: no duplicate/move-to-layer — just delete.
  rows.push({
    separatorBefore: true,
    label: 'Delete',
    danger: true,
    kbd: 'Del',
    onSelect: () => handleShortcut('delete'),
  })
  return rows
})

registerMenu('text', (ctx) => [
  headerRow(ctx.child),
  { label: 'Rotate 90°', onSelect: () => rotateSelection90() },
  ...sharedVerbs(ctx),
])

registerMenu('shape', (ctx) => [headerRow(ctx.child), ...sharedVerbs(ctx)])
registerMenu('water', (ctx) => [headerRow(ctx.child), ...sharedVerbs(ctx)])
registerMenu('zone', (ctx) => [headerRow(ctx.child), ...sharedVerbs(ctx)])

// ─── Rooms and areas ───────────────────────────────────────────────────────
//
// A room is not a child (it is a place on the floor, with a permanent id), so its
// menu has its own entry point; so does an area, which the rooms sheet's group header
// opens. Both read live from the store each render, like the child menus.

/**
 * How Rename asks for a name. The editor installs its own (an inline field); without
 * one, the browser's prompt does the job. Returning null cancels.
 */
export const roomNamePromptRef: {
  current: ((kind: 'room' | 'area', current: string) => string | null | Promise<string | null>) | null
} = { current: null }

async function askName(kind: 'room' | 'area', current: string): Promise<string | null> {
  const ask = roomNamePromptRef.current ?? ((_k: 'room' | 'area', cur: string) => window.prompt(kind === 'room' ? 'Room name' : 'Area name', cur))
  const raw = await ask(kind, current)
  const name = raw?.trim()
  return name && name !== current ? name : null
}

export interface RoomMenuContext {
  layer: DungeonLayer
  room: Room
  /** Current selection — the room is always part of it by the time a menu opens. */
  selectedIds: string[]
  /** Where the right-click landed, in world squares: Split here starts the line there. */
  world: { x: number; y: number }
}

/** "3 · Warren Hall", or the name alone for a room with no number. */
export function roomTitle(room: Pick<Room, 'name' | 'number'>): string {
  return room.number !== undefined ? `${room.number} · ${room.name}` : room.name
}

/** "Area 1", "Area 2"…: one past the highest numbered area name on the layer. */
function nextAreaName(layer: DungeonLayer): string {
  const max = (layer.areas ?? []).reduce((m, a) => {
    const hit = /^Area (\d+)$/.exec(a.name)
    return hit ? Math.max(m, Number(hit[1])) : m
  }, 0)
  return `Area ${max + 1}`
}

/**
 * Menu for a right-clicked room: Rename, Open key, Split here, Merge with… (exactly two
 * rooms selected on one layer), Add to area ▸, Delete room (the floor stays).
 */
export function buildRoomMenu({ layer, room, selectedIds, world }: RoomMenuContext): MenuRow[] {
  const rooms = layer.rooms ?? []
  // The verbs act on the selected rooms of this layer, the right-clicked one always among them.
  const picked = rooms.filter((r) => r.id === room.id || selectedIds.includes(r.id))
  const pickedIds = picked.map((r) => r.id)
  const area = room.areaId ? (layer.areas ?? []).find((a) => a.id === room.areaId) : undefined
  const rows: MenuRow[] = [
    {
      type: 'header',
      label: picked.length > 1 ? `${picked.length} rooms` : roomTitle(room),
      sublabel: area ? `Room · ${area.name}` : 'Room',
    },
    {
      label: 'Rename',
      disabled: picked.length > 1,
      onSelect: () => {
        void askName('room', room.name).then((name) => {
          if (name) undoManager.execute(new RenameRoomCommand(layer.id, room.id, room.name, name))
        })
      },
    },
    {
      label: 'Open key',
      onSelect: () => {
        const s = useStore.getState()
        s.setRoomsSheetRoomId(room.id)
        s.setRoomsSheetOpen(true)
      },
    },
    {
      label: 'Split here',
      onSelect: () => {
        const s = useStore.getState()
        if (s.ui.activeLayerId !== layer.id) s.setActiveLayerId(layer.id)
        // Split means a threshold: the dialog that follows decides which half keeps the room.
        if (s.ui.dividerMode !== 'threshold') s.setDividerMode('threshold')
        seedDivideStart(world)
        s.setSelectedIds([])
        s.setActiveTool('divide')
      },
    },
  ]

  const other = picked.length === 2 ? picked.find((r) => r.id !== room.id) : undefined
  if (other) {
    rows.push({
      label: `Merge with ${other.name}`,
      onSelect: () => {
        // The right-clicked room keeps its id (name, key, fog); the other folds into it.
        undoManager.execute(new MergeRoomsCommand(layer.id, room.id, other.id))
        useStore.getState().setSelectedIds([room.id])
      },
    })
  }

  const areas = layer.areas ?? []
  const areaRows: MenuRow[] = areas.map((a: RoomArea) => ({
    label: a.name,
    checked: picked.every((r) => r.areaId === a.id),
    onSelect: () => undoManager.execute(new AssignRoomsToAreaCommand(layer.id, pickedIds, a.id)),
  }))
  areaRows.push({
    separatorBefore: areas.length > 0,
    label: 'New area',
    onSelect: () => {
      const created = { id: crypto.randomUUID(), name: nextAreaName(layer) }
      undoManager.execute(new AddAreaCommand(layer.id, created, pickedIds))
    },
  })
  if (picked.some((r) => r.areaId)) {
    areaRows.push({
      label: 'Remove from area',
      onSelect: () => undoManager.execute(new AssignRoomsToAreaCommand(layer.id, pickedIds, null)),
    })
  }
  rows.push({ separatorBefore: true, type: 'submenu', label: 'Add to area', rows: areaRows })

  rows.push({
    separatorBefore: true,
    label: picked.length > 1 ? 'Delete rooms' : 'Delete room',
    danger: true,
    kbd: 'Del',
    onSelect: () => {
      const cmds = pickedIds.map((id) => new RemoveRoomCommand(layer.id, id))
      undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Delete rooms', cmds))
      useStore.getState().setSelectedIds([])
    },
  })
  const reason = layer.locked ? 'Layer is locked' : !layer.visible ? 'Layer is hidden' : null
  return reason ? lockRows(rows, reason) : rows
}

export interface AreaMenuContext {
  layer: DungeonLayer
  area: RoomArea
}

/** Menu for an area (the rooms sheet's group header): Rename, Remove area (its rooms stay). */
export function buildAreaMenu({ layer, area }: AreaMenuContext): MenuRow[] {
  const count = (layer.rooms ?? []).filter((r) => r.areaId === area.id).length
  const rows: MenuRow[] = [
    { type: 'header', label: area.name, sublabel: `Area · ${count} room${count === 1 ? '' : 's'}` },
    {
      label: 'Rename',
      onSelect: () => {
        void askName('area', area.name).then((name) => {
          if (name) undoManager.execute(new RenameAreaCommand(layer.id, area.id, name))
        })
      },
    },
    {
      separatorBefore: true,
      label: 'Remove area',
      danger: true,
      onSelect: () => {
        undoManager.execute(new RemoveAreaCommand(layer.id, area.id))
        const s = useStore.getState()
        if (s.selection.selectedIds.includes(area.id)) s.setSelectedIds(s.selection.selectedIds.filter((id) => id !== area.id))
      },
    },
  ]
  const reason = layer.locked ? 'Layer is locked' : !layer.visible ? 'Layer is hidden' : null
  return reason ? lockRows(rows, reason) : rows
}

// ─── Entry points ──────────────────────────────────────────────────────────

/** Menu for a right-clicked child (single selection). */
export function buildChildMenu(ctx: ChildMenuContext): MenuRow[] {
  const builder = builders.get(ctx.child.childType)
  // A locked prop offers only its way back: every other verb would pass over it.
  const locked = ctx.child.childType === 'asset' && ctx.child.locked
  const rows = locked
    ? lockedPropRows(ctx.child as AssetChild)
    : withGroupRows(builder ? builder(ctx) : [headerRow(ctx.child), ...sharedVerbs(ctx)], ctx)
  const reason = ctx.layer.locked
    ? 'Layer is locked'
    : !ctx.layer.visible
      ? 'Layer is hidden'
      : null
  return reason ? lockRows(rows, reason) : rows
}

export interface WallMenuContext {
  layer: DungeonLayer
  wall: WallSegment
}

/**
 * Menu for a right-clicked drawn wall: what it is, then the shared verbs a wall can
 * take. No Duplicate: copies are children-only, and a wall is not a child.
 */
export function buildWallMenu({ layer, wall }: WallMenuContext): MenuRow[] {
  const setId = standaloneWallLook(wall, layer.style).setId
  const rows: MenuRow[] = [{ type: 'header', label: 'Wall', sublabel: setId ? wallSetLabel(setId) : 'Wall' }]
  rows.push(moveToLayerRow(layer.id, { separatorBefore: true }))
  rows.push({
    separatorBefore: true,
    label: 'Delete',
    danger: true,
    kbd: 'Del',
    onSelect: () => handleShortcut('delete'),
  })
  const reason = layer.locked ? 'Layer is locked' : !layer.visible ? 'Layer is hidden' : null
  return reason ? lockRows(rows, reason) : rows
}

/**
 * A locked or hidden layer's menu: every row disabled AND every callback
 * neutralised. The renderer's `disabled` handles the rows it knows; swapping
 * the callbacks for a warning is the backstop that keeps a row type added
 * later from writing through a lock it never learned about. The header's
 * sublabel says why, so the grey has an explanation.
 */
function lockRows(rows: MenuRow[], reason: string): MenuRow[] {
  const refuse = () => notify.warning(reason)
  return rows.map((r): MenuRow => {
    if (!('type' in r) || !r.type || r.type === 'action') {
      return { ...r, disabled: true, onSelect: refuse }
    }
    switch (r.type) {
      case 'header':
        return { ...r, sublabel: reason }
      case 'toggle':
        return { ...r, disabled: true, onToggle: refuse }
      case 'slider':
        // onChange stays silent — it fires per pixel; the commit warns once.
        return { ...r, disabled: true, onChange: () => {}, onCommit: refuse }
      case 'swatches':
        return { ...r, disabled: true, onPick: refuse }
      case 'thumbStrip':
        return {
          ...r,
          disabled: true,
          onPick: refuse,
          trailing: r.trailing ? { ...r.trailing, onSelect: refuse } : undefined,
        }
      case 'submenu':
        return { ...r, disabled: true, rows: lockRows(r.rows, reason) }
    }
  })
}

/** Menu for a mixed multi-selection: the shared-verb intersection only. */
export function buildMultiMenu(count: number): MenuRow[] {
  // Flips silently skip lights and labels, so a selection with nothing
  // flippable must not offer them — dead verbs read as broken ones.
  const store = useStore.getState()
  const ids = new Set(store.selection.selectedIds)
  const kinds = new Set<string>()
  for (const l of store.layers) {
    if (l.type !== 'dungeon') continue
    for (const c of l.children) if (ids.has(c.id)) kinds.add(c.childType)
  }
  const flippable = ['asset', 'shape', 'water'].some((k) => kinds.has(k))
  // Move-to-layer is most wanted exactly here — herding a mixed selection
  // onto one layer — so the multi menu offers it like every single menu does.
  const owners = new Set(
    store.layers.filter((l) => l.type === 'dungeon' && l.children.some((c) => ids.has(c.id))).map((l) => l.id),
  )
  const currentLayerId = owners.size === 1 ? [...owners][0] : null
  const selected = [...ids]
  // The props verbs, on v2: line the props up, space them, restack, lock them all.
  const propCount = store.layers.reduce(
    (n, l) => n + (l.type === 'dungeon' ? l.children.filter((c) => c.childType === 'asset' && ids.has(c.id)).length : 0),
    0,
  )
  const propRows: MenuRow[] =
    isV2Route() && propCount > 0
      ? [
          ...(propCount >= 2
            ? [
                {
                  type: 'submenu' as const,
                  label: 'Align',
                  separatorBefore: true,
                  rows: ALIGN_ROWS.map(({ edge, label }) => ({
                    label,
                    onSelect: () => run(createAlignCommand(selected, edge)),
                  })),
                },
                {
                  type: 'submenu' as const,
                  label: 'Distribute',
                  disabled: propCount < 3,
                  rows: [
                    { label: 'Horizontally', onSelect: () => run(createDistributeCommand(selected, 'h')) },
                    { label: 'Vertically', onSelect: () => run(createDistributeCommand(selected, 'v')) },
                  ],
                },
              ]
            : []),
          orderRow(selected),
          { label: 'Lock all', onSelect: () => run(createSetPropFieldsCommand(selected, { locked: true })) },
        ]
      : []
  return withGroupRows([
    { type: 'header', label: `${count} selected` },
    { label: 'Duplicate', kbd: 'Ctrl+D', onSelect: () => handleShortcut('ctrl+d') },
    ...(flippable
      ? [
          { label: 'Flip horizontal', kbd: 'Shift+H', onSelect: () => handleShortcut('shift+h') },
          { label: 'Flip vertical', kbd: 'Shift+V', onSelect: () => handleShortcut('shift+v') },
        ]
      : []),
    ...propRows,
    moveToLayerRow(currentLayerId),
    {
      separatorBefore: true,
      label: 'Delete',
      danger: true,
      kbd: 'Del',
      onSelect: () => handleShortcut('delete'),
    },
  ])
}

/** Menu for empty ground: paste, select, view. */
export function buildCanvasMenu(world: { x: number; y: number }): MenuRow[] {
  const store = useStore.getState()
  const clipboard = store.selection.clipboard
  const activeLayer = store.layers.find(
    (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
  )
  return [
    {
      label: 'Paste here',
      kbd: 'Ctrl+V',
      disabled: !clipboard || clipboard.children.length === 0 || !activeLayer,
      onSelect: () => pasteAt(world),
    },
    {
      label: 'Select all in layer',
      disabled: !activeLayer || activeLayer.children.length === 0,
      onSelect: () => {
        if (!activeLayer) return
        // Locked props stay out, as they stay out of a marquee.
        useStore
          .getState()
          .setSelectedIds(activeLayer.children.filter((c) => !(c.childType === 'asset' && c.locked)).map((c) => c.id))
      },
    },
    {
      separatorBefore: true,
      label: 'Zoom to fit',
      kbd: 'Ctrl+0',
      onSelect: () => zoomToFitRef.current?.(),
    },
  ]
}

/** Paste the clipboard centred on a world point instead of the +1,+1 offset. */
function pasteAt(world: { x: number; y: number }): void {
  const store = useStore.getState()
  const clipboard = store.selection.clipboard
  const activeLayer = store.layers.find(
    (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
  )
  if (!clipboard || clipboard.children.length === 0 || !activeLayer) return
  if (activeLayer.locked || !activeLayer.visible) {
    notify.warning(activeLayer.locked ? 'Layer is locked' : 'Layer is hidden')
    return
  }

  // The one duplicate path, centred on the click so a group pastes around it.
  const { command } = createDuplicateCommand(store.layers, [], {
    children: clipboard.children,
    targetLayerId: activeLayer.id,
    centreAt: world,
    label: 'Paste',
  })
  if (command) undoManager.execute(command)
}
