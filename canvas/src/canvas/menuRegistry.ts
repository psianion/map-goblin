// Canvas context-menu contribution registry.
//
// One menu anatomy for every child kind: identity header → type quick-controls
// → type verbs → shared verbs → danger. Each kind registers a builder that
// returns typed rows; the renderer (context-menu.tsx) switches on row type and
// never on what the menu is for, so a new child kind means a new builder here
// and nothing else.

import type { MenuRow } from '@/components/ui/context-menu'
import { useStore } from '@/store/store'
import { undoManager } from '@/store/undoManager'
import {
  AddChildCommand,
  RemoveChildCommand,
  CompositeCommand,
  UpdateChildCommand,
} from '@/store/commands'
import type { AnyChild, DoorChild, DoorStyle, DungeonLayer, LightChild } from '@/store/types'
import { selectLayerForChild } from '@/store/selectors'
import { getTextureEntry, getTexturesByCategory } from '@dnd/core/src/assets/textureManifest'
import { translateTangents } from '@dnd/core/src/shared/bezier'
import { handleShortcut, rotateSelection90 } from '@/shortcuts/defaultShortcuts'
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

/** Move the current selection to another dungeon layer, one undo entry. */
function moveSelectionToLayer(targetLayerId: string): void {
  const store = useStore.getState()
  const cmds: (RemoveChildCommand | AddChildCommand)[] = []
  for (const id of store.selection.selectedIds) {
    const layer = selectLayerForChild(store, id)
    const child = layer?.children.find((c) => c.id === id)
    if (!layer || !child || layer.id === targetLayerId) continue
    cmds.push(new RemoveChildCommand('Move to layer', layer.id, id))
    cmds.push(new AddChildCommand('Move to layer', targetLayerId, structuredClone(child)))
  }
  if (cmds.length === 0) return
  undoManager.execute(new CompositeCommand('Move to layer', cmds))
}

/**
 * Verbs every child menu ends with. The danger slot (Delete) stays last —
 * the eye finds it in the same place in every menu.
 */
function sharedVerbs(ctx: ChildMenuContext): MenuRow[] {
  const store = useStore.getState()
  const otherLayers = store.layers.filter(
    (l): l is DungeonLayer => l.type === 'dungeon' && l.id !== ctx.layer.id && !l.locked,
  )
  const rows: MenuRow[] = [
    {
      separatorBefore: true,
      label: 'Duplicate',
      kbd: 'Ctrl+D',
      onSelect: () => handleShortcut('ctrl+d'),
    },
  ]
  if (otherLayers.length > 0) {
    rows.push({
      type: 'submenu',
      label: 'Move to layer',
      rows: otherLayers.map((l) => ({
        label: l.name,
        onSelect: () => moveSelectionToLayer(l.id),
      })),
    })
  }
  rows.push({
    separatorBefore: true,
    label: 'Delete',
    danger: true,
    kbd: 'Del',
    onSelect: () => handleShortcut('delete'),
  })
  return rows
}

// ─── Per-kind builders ─────────────────────────────────────────────────────

registerMenu('asset', (ctx) => {
  const child = ctx.child
  if (child.childType !== 'asset') return []
  const rows: MenuRow[] = [headerRow(child)]

  // Swap strip: manifest neighbours from the same category. Pack assets
  // (`pack-id:texture`) have no manifest entry — the strip simply doesn't
  // appear for them rather than showing an empty shelf.
  const entry = getTextureEntry(child.assetId)
  if (entry) {
    const neighbours = getTexturesByCategory(entry.category).slice(0, 8)
    if (neighbours.length > 1) {
      rows.push({
        type: 'thumbStrip',
        label: 'Swap',
        items: neighbours.map((n) => ({
          id: n.id,
          src: n.path,
          title: n.label,
          active: n.id === child.assetId,
        })),
        onPick: (id) => {
          if (id === child.assetId) return
          commitChild('Swap prop', ctx.layer.id, child.id, { assetId: child.assetId }, { assetId: id })
        },
      })
    }
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
  return [...rows, ...sharedVerbs(ctx)]
})

const LIGHT_SWATCHES = ['#ffdd88', '#ffb45e', '#ff7a5e', '#aec8ff', '#b7ffd9', '#e8e4d8']
const LIGHT_SWATCH_NAMES = ['Candlelight', 'Torchlight', 'Embers', 'Moonlight', 'Faerie glow', 'Daylight']

registerMenu('light', (ctx) => {
  const child = ctx.child
  if (child.childType !== 'light') return []
  const layerId = ctx.layer.id
  const patch = (p: Partial<LightChild>) => useStore.getState().updateChild(layerId, child.id, p)
  const rows: MenuRow[] = [
    headerRow(child),
    {
      type: 'slider',
      label: 'Radius',
      value: child.radius,
      min: 0.5,
      max: 15,
      step: 0.5,
      onChange: (v) => patch({ radius: v }),
      onCommit: (next, start) =>
        commitChild('Light radius', layerId, child.id, { radius: start }, { radius: next }),
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
    {
      type: 'swatches',
      label: 'Colour',
      value: child.color,
      options: LIGHT_SWATCHES,
      optionNames: LIGHT_SWATCH_NAMES,
      onPick: (color) =>
        commitChild('Light colour', layerId, child.id, { color: child.color }, { color }),
    },
  ]
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
        onSelect: () =>
          commitChild('Door style', layerId, child.id, { style: child.style }, { style: s.value }),
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

// ─── Entry points ──────────────────────────────────────────────────────────

/** Menu for a right-clicked child (single selection). */
export function buildChildMenu(ctx: ChildMenuContext): MenuRow[] {
  const builder = builders.get(ctx.child.childType)
  const rows = builder ? builder(ctx) : [headerRow(ctx.child), ...sharedVerbs(ctx)]
  const reason = ctx.layer.locked
    ? 'Layer is locked'
    : !ctx.layer.visible
      ? 'Layer is hidden'
      : null
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
  const targetLayers = store.layers.filter(
    (l): l is DungeonLayer => l.type === 'dungeon' && !l.locked,
  )
  return [
    { type: 'header', label: `${count} selected` },
    { label: 'Duplicate', kbd: 'Ctrl+D', onSelect: () => handleShortcut('ctrl+d') },
    ...(flippable
      ? [
          { label: 'Flip horizontal', kbd: 'Shift+H', onSelect: () => handleShortcut('shift+h') },
          { label: 'Flip vertical', kbd: 'Shift+V', onSelect: () => handleShortcut('shift+v') },
        ]
      : []),
    ...(targetLayers.length > 0
      ? [
          {
            type: 'submenu' as const,
            label: 'Move to layer',
            rows: targetLayers.map((l) => ({
              label: l.name,
              onSelect: () => moveSelectionToLayer(l.id),
            })),
          },
        ]
      : []),
    {
      separatorBefore: true,
      label: 'Delete',
      danger: true,
      kbd: 'Del',
      onSelect: () => handleShortcut('delete'),
    },
  ]
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
        useStore.getState().setSelectedIds(activeLayer.children.map((c) => c.id))
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

  // Union centre of the clipboard, so a group pastes around the click.
  const centres: [number, number][] = []
  for (const c of clipboard.children) {
    if ('position' in c && !Array.isArray(c.position)) centres.push([c.position.x, c.position.y])
    else if ('position' in c && Array.isArray(c.position)) centres.push([c.position[0], c.position[1]])
    else if ('contours' in c && c.contours[0]?.length) {
      const xs = c.contours[0].map((p) => p[0])
      const ys = c.contours[0].map((p) => p[1])
      centres.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2])
    }
  }
  if (centres.length === 0) return
  const cx = centres.reduce((s, p) => s + p[0], 0) / centres.length
  const cy = centres.reduce((s, p) => s + p[1], 0) / centres.length
  const dx = world.x - cx
  const dy = world.y - cy

  const cmds = clipboard.children.map((orig) => {
    const copy = structuredClone(orig)
    copy.id = crypto.randomUUID()
    copy.name = `${orig.name} (copy)`
    if ('position' in copy && !Array.isArray(copy.position)) {
      copy.position = { x: copy.position.x + dx, y: copy.position.y + dy }
    } else if ('position' in copy && Array.isArray(copy.position)) {
      copy.position = [copy.position[0] + dx, copy.position[1] + dy]
    } else if ('transform' in copy && copy.transform) {
      copy.transform.translate = [copy.transform.translate[0] + dx, copy.transform.translate[1] + dy]
    } else if ('contours' in copy) {
      copy.contours = copy.contours.map((ring) =>
        ring.map(([x, y]): [number, number] => [x + dx, y + dy]),
      )
      copy.tangents = translateTangents(copy.tangents, dx, dy)
    }
    return new AddChildCommand('Paste child', activeLayer.id, copy)
  })
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Paste', cmds))
}
