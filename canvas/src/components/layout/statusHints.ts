// What the status bar says while a node editor is open: which mode, and its key map.
//
// Both status bars read this, so the v1 bar's plain line and the v2 bar's keycaps can
// never drift apart. Pure: it takes the tools state and the band-id parser, so it can be
// tested without a store or a renderer.

import type { BandDragStatus, ToolsSlice } from '@/store/types';

export type EditHintKind = 'band' | 'wall' | 'outline';

/** One run of a hint: plain words, or a key to press (drawn as a keycap in v2). */
export interface HintSegment {
  text: string;
  key?: boolean;
}

export interface EditHint {
  kind: EditHintKind;
  /** The mode, e.g. "Editing wall". */
  label: string;
  /** The key map or solver read-out as one line, keys inline: "Tab piece · Esc done". */
  text: string;
  /** The same line split so keys can be drawn apart from the words around them. */
  segments: HintSegment[];
}

export type EditHintTools = Pick<
  ToolsSlice,
  'nodeEditWallId' | 'shapeNodeEditId' | 'selectedNodeT' | 'selectedNodeTs' | 'bandDragStatus'
>;

/**
 * Hints are written with keys in angle brackets, so each one reads as a sentence here
 * and still knows which runs are keys. `<Shift>+click groups` is a Shift keycap.
 */
function parse(source: string): Pick<EditHint, 'text' | 'segments'> {
  const segments: HintSegment[] = [];
  for (const part of source.split(/(<[^>]+>)/)) {
    if (!part) continue;
    if (part.startsWith('<') && part.endsWith('>')) segments.push({ text: part.slice(1, -1), key: true });
    else segments.push({ text: part });
  }
  return { text: segments.map((s) => s.text).join(''), segments };
}

function hint(kind: EditHintKind, label: string, source: string): EditHint {
  return { kind, label, ...parse(source) };
}

// Built once, so a status bar that re-reads the same mode gets the same object back.
const HINTS = {
  bandNode: hint(
    'band',
    'Editing cave wall',
    'drag to move · <{> <}> insert · <Del> straighten · <Tab> re-lay wall · <Esc> done',
  ),
  bandNone: hint('band', 'Editing cave wall', 'click a joint · <Shift>+click groups · double-click elsewhere exits'),
  // A drawn wall on a cave kit: its rock is walked along the wall's own line, so
  // the line's corners are what moves.
  spineNode: hint('band', 'Editing cave wall', 'drag the corner, the rock follows · <Del> removes it · <Esc> done'),
  spineNone: hint('band', 'Editing cave wall', 'drag a corner of the line, the rock follows · <Esc> done'),
  wallNode: hint(
    'wall',
    'Editing wall',
    '<[> <]> rotate · <-> <+> size · <,> <.> gap · <Tab> piece · <{> <}> insert · <Del> remove · <Esc> done',
  ),
  wallNone: hint('wall', 'Editing wall', 'click a stone · <Shift>+click groups · double-click elsewhere exits'),
  outline: hint(
    'outline',
    'Editing outline',
    'drag a corner to move it · click a midpoint to add one · <Delete> removes · <Alt> curves · <Esc> done',
  ),
} as const;

/**
 * What the cave-band solver just answered, in one line.
 *
 * The pieces are named because the kit is the whole vocabulary — a DM who can
 * see which stones the wall is being built from can tell a good fit from a
 * lucky one. `kitPull` is how far the kit dragged the handle off the cursor,
 * which is the number that says whether the constraint is helping or fighting.
 */
export function bandStatusText(status: BandDragStatus | null): string {
  if (!status) return '';
  if ('refusal' in status) return status.refusal;
  const names = [...new Set(status.pieces)].join(', ').replace(/_/g, ' ');
  return `${names} · kit pull ${status.kitPull.toFixed(2)} cells`;
}

/**
 * The hint for whichever node editor is open, or null when none is. A cave band wins
 * over a wall (its id is a wall id too), a wall over an outline. A live band drag
 * replaces the key map with the solver's answer.
 */
export function editHint(
  tools: EditHintTools,
  bandRunIndex: (wallId: string) => number | null,
): EditHint | null {
  const nodeSelected = tools.selectedNodeT !== null || tools.selectedNodeTs.length > 0;
  const wallId = tools.nodeEditWallId;
  if (wallId && bandRunIndex(wallId) !== null) {
    const status = bandStatusText(tools.bandDragStatus);
    if (status) return { kind: 'band', label: HINTS.bandNode.label, text: status, segments: [{ text: status }] };
    return nodeSelected ? HINTS.bandNode : HINTS.bandNone;
  }
  // `spine:<wallId>`, see SPINE_WALL_PREFIX in wallNodeOverlay.ts. Read off the id
  // so this stays pure.
  if (wallId?.startsWith('spine:')) return nodeSelected ? HINTS.spineNode : HINTS.spineNone;
  if (wallId) return nodeSelected ? HINTS.wallNode : HINTS.wallNone;
  if (tools.shapeNodeEditId) return HINTS.outline;
  return null;
}
