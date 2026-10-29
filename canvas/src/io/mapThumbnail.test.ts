import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setEditorDesk, type EditorDesk } from '@dnd/core/src/engine/editorDesk';
import { useStore } from '@/store/store';
import { captureMapThumbnail } from './mapThumbnail';

const { pipeline, singleton } = vi.hoisted(() => ({
  pipeline: vi.fn(async () => ({ blob: new Blob(['x']), filename: 't.jpeg' })),
  singleton: { current: { engine: {}, sceneGraph: {} } as unknown },
}));
vi.mock('@/engine/engineSingleton', () => ({ getEngineSingleton: () => singleton.current }));
vi.mock('@/engine/export/exportPipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/engine/export/exportPipeline')>()),
  runExportPipeline: pipeline,
}));

const desk: EditorDesk = { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' };
type Opts = { format: string; pxPerCell: number; includeGrid: boolean; lighting?: boolean };
const lastOpts = () => (pipeline.mock.calls.at(-1) as unknown as [unknown, unknown, unknown, Opts])[3];

describe('captureMapThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    singleton.current = { engine: {}, sceneGraph: {} };
    useStore.getState().resetToDefault();
  });
  afterEach(() => setEditorDesk(null));

  it('follows the editor: unlit while the desk shows the map unlit', async () => {
    setEditorDesk(desk);
    await captureMapThumbnail();
    expect(lastOpts()).toMatchObject({ format: 'jpeg', includeGrid: false, lighting: false });
  });

  it('lit with the lit preview on, and lit without a desk', async () => {
    setEditorDesk({ ...desk, lit: true });
    await captureMapThumbnail();
    expect(lastOpts().lighting).toBe(true);

    setEditorDesk(null);
    await captureMapThumbnail();
    expect(lastOpts().lighting).toBe(true);
  });

  it('sizes the longer side to 480 px', async () => {
    await captureMapThumbnail();
    // The default 10x10 frame.
    expect(lastOpts().pxPerCell).toBe(48);
  });

  it('is null with no canvas to render from', async () => {
    singleton.current = null;
    expect(await captureMapThumbnail()).toBeNull();
    expect(pipeline).not.toHaveBeenCalled();
  });
});
