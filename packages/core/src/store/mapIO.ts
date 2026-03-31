import type { SerializedMapData } from './types';

/** Interface matching the subset of MapIndexDB used by the maps slice. */
export interface MapDB {
  open(): Promise<void>;
  getAllMapMeta(): Promise<MapMeta[]>;
  saveMapBlob(id: string, data: Uint8Array, gridSize: { width: number; height: number }, layerCount: number): Promise<void>;
  getMapBlob(id: string): Promise<Uint8Array | null>;
  createMap(name: string, data: Uint8Array, gridSize: { width: number; height: number }, layerCount: number): Promise<string>;
  getMapMeta(id: string): Promise<MapMeta | null>;
  deleteMap(id: string): Promise<void>;
  updateMapMeta(id: string, patch: Partial<Pick<MapMeta, 'name'>>): Promise<void>;
  duplicateMap(id: string): Promise<string>;
}

export interface MapMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  gridSize: { width: number; height: number };
  layerCount: number;
}

export interface MapSerializer {
  serializeToBytes(data: SerializedMapData): Promise<Uint8Array>;
  deserializeFromBytes(bytes: Uint8Array): Promise<SerializedMapData>;
}

// ─── Injectable factories ─────────────────────────────────

type MapDBFactory = () => MapDB;

let _mapDBFactory: MapDBFactory | null = null;
let _serializer: MapSerializer | null = null;

export function setMapDBFactory(factory: MapDBFactory): void {
  _mapDBFactory = factory;
}

export function getMapDBFactory(): MapDBFactory {
  if (!_mapDBFactory) throw new Error('@dnd/core: setMapDBFactory() must be called before using map persistence');
  return _mapDBFactory;
}

export function setMapSerializer(serializer: MapSerializer): void {
  _serializer = serializer;
}

export function getMapSerializer(): MapSerializer {
  if (!_serializer) throw new Error('@dnd/core: setMapSerializer() must be called before using map persistence');
  return _serializer;
}
