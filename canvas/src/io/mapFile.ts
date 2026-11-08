// The editor's own map file: which files are one, and the shape a map document must have,
// a zod schema per format version, checked where a document comes in and goes out.
//
// The schemas hold what the editor relies on and pass everything else through, so a field
// this build does not know survives a round trip. The settings the editor dropped
// (removedFields.ts) are taken off a document before it is saved.

import { z } from 'zod';
import type { SerializedMapData } from '@/store/types';
import { SUPPORTED_VERSIONS } from '@dnd/core/src/store/migration';
import { dropRemovedFields } from '@dnd/core/src/store/removedFields';
import { hasMagicHeader, parsePlainMapJson } from '@/io/mapFormat';

/**
 * It is being renamed from .mapbuilder to .ggvtt; both open. What makes a file one is its
 * content, not its name; the extensions only steer the picker: the container header, or
 * (older .mapbuilder files) a plain JSON map document.
 */
export const MAP_FILE_ACCEPT = '.ggvtt,.mapbuilder';

/** Whether the file is one of the editor's map files. Unreadable files (a dropped folder) are not. */
export async function isMapFile(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (hasMagicHeader(head)) return true;
    // Only a file that could be JSON is read whole.
    const first = head.find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0xef && b !== 0xbb && b !== 0xbf);
    if (first !== 0x7b) return false;
    return parsePlainMapJson(new Uint8Array(await file.arrayBuffer())) !== null;
  } catch {
    return false;
  }
}

/* ── The document, version by version ─────────────────── */

type Version = SerializedMapData['version'];

const layer = z.object({ id: z.string(), type: z.string() }).passthrough();
const mapSettings = z.object({ name: z.string() }).passthrough();
const grid = z.object({ visible: z.boolean().optional(), snapDivision: z.number().optional() }).passthrough();

/** 2.0: before levels, walls with their own light flags. Migrated to 3.x on load. */
const v2 = z
  .object({ version: z.literal('2.0'), mapSettings, layers: z.array(layer), customImages: z.record(z.string(), z.string()).optional() })
  .passthrough();

/** 3.x: the same top level throughout; each step since moved fields inside layers (migration.ts). */
/** 3.5's additions: the terrain's smooth blending, a floor's own opacity and edge band. */
const settings35 = mapSettings.extend({ terrain: z.object({ smoothBlend: z.boolean().optional() }).passthrough().optional() });
const child35 = z.object({ opacity: z.number().min(0).max(1).optional(), edgeBand: z.string().nullable().optional() }).passthrough();
const cornerStyle = z.enum(['rounded', 'sharp']).optional();
const child36 = child35.extend({ freestanding: z.boolean().optional() });
const layer36 = layer.extend({
  children: z.array(child36).optional(),
  standaloneWalls: z.array(z.object({ cornerStyle }).passthrough()).optional(),
  style: z.object({ wallCornerStyle: cornerStyle }).passthrough().optional(),
});
/** 3.7: a layer's water, its mask as runs over a texel grid (shared/waterMask.ts) and its look. */
const water = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().min(0),
    h: z.number().int().min(0),
    runs: z.string(),
    shallow: z.string(),
    deep: z.string(),
    blend: z.number().min(0),
    border: z.boolean(),
  })
  .passthrough();
/** 3.7: a path child, its nodes as one open ring (shared/pathway.ts). */
const pathway = z
  .object({
    childType: z.literal('pathway'),
    contours: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
    pieceId: z.string(),
    width: z.number().positive(),
    smoothness: z.number().min(0).max(1),
    curve: z.boolean(),
    transitionIn: z.enum(['hard', 'fade', 'grow']),
    transitionOut: z.enum(['hard', 'fade', 'shrink']),
    blocksLight: z.boolean(),
  })
  .passthrough();
/** A 3.7 child: a path is checked as one, every other kind as in 3.6. */
const child37 = child36.superRefine((c, ctx) => {
  if (c.childType !== 'pathway') return;
  const parsed = pathway.safeParse(c);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, code: 'custom', message: issue.message });
});
/** 3.7: a Material brush patch, its outline as rings (shared/materialPatch.ts). */
const patch = z
  .object({
    id: z.string(),
    material: z.string(),
    rings: z.array(z.array(z.tuple([z.number(), z.number()]))),
    smooth: z.boolean(),
    border: z.boolean(),
  })
  .passthrough();

/** A 3.7 layer: water, material patches and path children. */
const layer37 = layer36.extend({ children: z.array(child37).optional(), water: water.optional(), materials: z.array(patch).optional() });
/** 3.8: a prop's below-water flag. */
const child38 = child37.and(z.object({ belowWater: z.boolean().optional() }).passthrough());
/** 3.8: a trace (background image layer), its picture's key, the file it came from and its fit. */
const trace = z
  .object({ type: z.literal('image'), imageKey: z.string().min(1), fileName: z.string(), fit: z.enum(['map', 'original']) })
  .passthrough();
const traceCheck = (l: { type: string }, ctx: z.RefinementCtx) => {
  if (l.type !== 'image') return;
  const parsed = trace.safeParse(l);
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, code: 'custom', message: issue.message });
};
const layer38 = layer37.extend({ children: z.array(child38).optional() }).superRefine(traceCheck);
/** 3.9: an imported picture's file name and its own pixel size. */
const imageSource = z.object({ fileName: z.string(), width: z.number().positive(), height: z.number().positive() }).passthrough();
const child39 = child38.and(z.object({ imageSource: imageSource.optional() }).passthrough());
const layer39 = layer37.extend({ children: z.array(child39).optional() }).superRefine(traceCheck);

const v3 = (version: Exclude<Version, '2.0'>, settings: z.ZodType = mapSettings, layers: z.ZodType = layer) =>
  z
    .object({
      version: z.literal(version),
      mapSettings: settings,
      grid: grid.optional(),
      layers: z.array(layers),
      levels: z.array(z.object({ id: z.string() }).passthrough()).optional(),
      customImages: z.record(z.string(), z.string()).optional(),
      prep: z.unknown().optional(),
    })
    .passthrough();

export const MAP_SCHEMAS: Record<Version, z.ZodType> = {
  '2.0': v2,
  '3.0': v3('3.0'),
  '3.1': v3('3.1'),
  '3.2': v3('3.2'),
  '3.3': v3('3.3'),
  '3.4': v3('3.4'),
  // 3.5 adds the terrain's smooth blending switch (absent, the blend is the ragged one) and a
  // floor's own opacity and edge band (absent, full and the layer's).
  '3.5': v3('3.5', settings35, layer.extend({ children: z.array(child35).optional() })),
  // 3.6 adds a wall's and a layer's corner style (absent, sharp) and a door's freestanding
  // flag (absent, on a wall).
  '3.6': v3('3.6', settings35, layer36),
  // 3.7 adds a layer's water (absent, dry), its material patches (absent, none) and path
  // children.
  '3.7': v3('3.7', settings35, layer37),
  // 3.8 adds a prop's below-water flag (absent, drawn as it is) and trace layers.
  '3.8': v3('3.8', settings35, layer38),
  '3.9': v3('3.9', settings35, layer39),
};

/** The first problem with a document, said plainly. */
function problem(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'the document'}: ${issue.message}` : 'unreadable';
}

/**
 * A document read from a file, checked against its version's schema. Throws a readable
 * error for a version this app cannot open or a document that is not a map.
 */
export function readMapDocument(doc: unknown): SerializedMapData {
  const version = (doc as { version?: unknown } | null)?.version;
  if (typeof version !== 'string' || !(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(`Incompatible file version "${String(version)}". This app requires one of: ${SUPPORTED_VERSIONS.join(', ')}.`);
  }
  const parsed = MAP_SCHEMAS[version as Version].safeParse(doc);
  if (!parsed.success) throw new Error(`Invalid map file (${problem(parsed.error)}).`);
  // The document as it came, not the parse: the schemas only check, and the parse would
  // reorder each layer's keys, which changes the map's publish hash on every reload.
  return doc as SerializedMapData;
}

/**
 * The document a save writes: the dropped settings off, checked against its version (the
 * store stamps the current one). A version this build does not know is left for the reader
 * to refuse.
 */
export function saveableMap(data: SerializedMapData): SerializedMapData {
  const doc = dropRemovedFields(data);
  const schema = MAP_SCHEMAS[doc.version];
  if (!schema) return doc;
  const parsed = schema.safeParse(doc);
  if (!parsed.success) throw new Error(`The map could not be saved (${problem(parsed.error)}).`);
  return doc;
}
