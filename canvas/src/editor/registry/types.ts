// The registry's shapes: what a tool, a family, a setting and a card are, as data.
//
// A setting is a description and a parse boundary over the core store, never a second
// copy of a value: every SettingDef is bound to the field in the core store it reads and
// writes. The only React in here is the icon and the render of a custom control.

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { z } from 'zod';
import type { useStore } from '@/store/store';
import type { HintSegment } from '@/editor/statusHints';
import type { AssetTypeFilter } from '@/editor/assetTypeFilter';
import type { AnyChild, ChildType, Room, ToolType, WallSegment } from '@/store/types';
import type { createDefaultState } from '@/store/factories';

/** Where a setting renders. Each setting has exactly one. */
export type Home = 'dock' | 'panel' | 'card';

export type Control =
  | 'slider'
  | 'range' // two thumbs, the value is [low, high]
  | 'switch'
  | 'seg'
  | 'select'
  | 'stepper'
  | 'input'
  | 'colour'
  | 'swatches' // options are the swatches, value the colour or id picked
  | 'button'
  | 'readout' // a value shown, not edited: a card's Size
  | 'custom';

/** What a binding, a hint and a visibility rule read: the core store's data. */
export type EditorState = ReturnType<typeof createDefaultState>;

/** The core store: bindings write through its actions or an immer recipe on setState. */
export type CoreStore = Pick<typeof useStore, 'getState' | 'setState' | 'subscribe'>;

/** How a setting reaches its value in the core store. */
export interface Binding<T> {
  read(state: EditorState): T;
  write(store: CoreStore, value: T): void;
}

/** What a custom control is handed. */
export interface SettingProps<T> {
  def: SettingMeta<T>;
  value: T;
  onChange: (value: T) => void;
}

/** One choice of a seg, select or swatches control. In the dock a seg draws its icons. */
export interface SettingOption<T> {
  value: T;
  label: string;
  icon?: LucideIcon;
  key?: string;
}

/** What every setting and card field says about itself, whatever it is bound to. */
export interface SettingMeta<T> {
  /** Unique across the registry: 'floor.opacity', 'grid.snap'. */
  id: string;
  label: string;
  /** Validates every write and every value loaded from prefs. */
  schema: z.ZodType<T>;
  default: T;
  home: Home;
  control: Control;
  /** Caption the setting sits under in the panel or the card. */
  section?: string;
  options?: ReadonlyArray<SettingOption<T>>;
  /** For slider, range and stepper. */
  range?: { min: number; max: number; step: number; unit?: string };
  /** A dock switch draws as this icon button, with `key` at its corner. */
  icon?: LucideIcon;
  key?: string;
  /** Only for control 'custom'. */
  render?: ComponentType<SettingProps<T>>;
}

/**
 * A tool setting, bound to the core store. Give `path` for a field inside
 * `tools.settings` (the id and the path may differ), or `bind` for anything else.
 */
export type SettingDef<T = unknown> = SettingMeta<T> & {
  /** Hidden unless this holds, e.g. Sides only for a regular polygon. Reads other settings by id. */
  visibleWhen?: (get: (id: string) => unknown) => boolean;
  /**
   * false: not saved in the tool settings prefs. Either the value is transient (node mode)
   * or something else already keeps it (snap in snapPref.ts, the snap step in the map file).
   */
  persist?: false;
} & ({ path: string; bind?: never } | { bind: Binding<T>; path?: never });

/** The status bar line: the tool's name, then words and keys in order (keys draw as keycaps). */
export interface HintLine {
  label: string;
  segments: ReadonlyArray<HintSegment>;
}

export interface DockColumnProps {
  tool: ToolDef;
}

/** A column in the dock after Level and Layers: swatches, presets, a texture strip. */
export interface DockColumnDef {
  id: string;
  caption?: string;
  render: ComponentType<DockColumnProps>;
}

/** A key a tool answers while it is in hand. Without `run` the key goes to the tool itself. */
export interface ToolKey {
  id: string;
  /** As the shortcut table writes it: lower case, modifiers first ('[', 'shift+r'). */
  combo: string;
  label: string;
  run?: (store: CoreStore) => void;
}

export interface ToolDef {
  id: string;
  label: string;
  /** The flyout's second line. */
  description: string;
  icon: LucideIcon;
  /** One letter, unique within the rail and within the tool's family. */
  key: string;
  /**
   * The core tools this tool drives. Picking it puts the first in hand unless one of them
   * already is; it is the tool in hand while any of them is (Floor: rectangle, polygon,
   * regular polygon, its shape row choosing among them).
   */
  engine: ReadonlyArray<ToolType>;
  /** Several tools on one core tool (Stamp and Scatter on the props brush): whether this one is in hand. */
  inHand?: (state: EditorState) => boolean;
  /** Runs after the tool's core tool is in hand, to set what tells it apart (Stamp's stamp mode). */
  onPick?: (store: CoreStore) => void;
  /** References: a shared def (registry/shared.ts) may appear in many tools. Order is render order. */
  settings: ReadonlyArray<SettingDef>;
  dock: ReadonlyArray<DockColumnDef>;
  hint: (state: EditorState) => HintLine;
  /** The panel foot's Save as preset, for tools that keep presets. */
  savePreset?: (store: CoreStore) => void;
  /** Panel content after the settings that is not a setting: Select's how-to and Previous tool. */
  panelExtra?: ComponentType<{ tool: ToolDef }>;
  /**
   * What the slot shows in place of the panel while this tool is in hand and something is
   * picked: Select's card host. A tool without one keeps its panel whatever is picked.
   */
  selectionPanel?: ComponentType;
  /** Keys the tool answers while in hand beyond its settings' own: Terrain's [ and ] size the brush. */
  keys?: ReadonlyArray<ToolKey>;
  /** Opens the asset library on this kind when the tool comes into hand (the Objects tools). */
  opensAssets?: AssetTypeFilter;
}

export interface FamilyDef {
  id: 'design' | 'terrain' | 'objects' | 'environment' | 'text';
  label: string;
  icon: LucideIcon;
  key: string;
  tools: ReadonlyArray<ToolDef>;
}

/** What a card can be for: every child kind, drawn walls and rooms. */
export type ObjectKind = ChildType | 'wall' | 'room';

export type ObjectOf<K extends ObjectKind> = K extends ChildType
  ? Extract<AnyChild, { childType: K }>
  : K extends 'wall'
    ? WallSegment
    : Room;

/** A button on a card's action row: Flip H, Duplicate, Merge. */
export interface Verb {
  id: string;
  label: string;
  icon: LucideIcon;
  key?: string;
  /** Delete: drawn in the danger colour, last in the row. */
  danger?: boolean;
  /** false: on the card's action row only, not on the floating bar by the selection. */
  bar?: false;
  /** Shown only when this holds, e.g. Merge with two walls picked. */
  when?: (state: EditorState) => boolean;
  run: (store: CoreStore) => void;
}

/**
 * A card field reads the picked object and writes through the command layer, so undo
 * keeps working. It is never saved in prefs.
 */
export type CardFieldDef<K extends ObjectKind = ObjectKind, T = unknown> = SettingMeta<T> & {
  home: 'card';
  read: (o: ObjectOf<K>) => T;
  write: (store: CoreStore, ids: readonly string[], value: T) => void;
  visibleWhen?: (o: ObjectOf<K>) => boolean;
};

export interface CardDef<K extends ObjectKind = ObjectKind> {
  kind: K;
  title: (o: ObjectOf<K>) => string;
  verbs: ReadonlyArray<Verb>;
  fields: ReadonlyArray<CardFieldDef<K>>;
}
