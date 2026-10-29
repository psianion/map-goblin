import { Graphics, type Container } from 'pixi.js';
import type { RenderEngine } from './RenderEngine';
import type { SceneGraph } from './sceneGraph';
import { getLayerEntries } from './sceneGraph';
import { layerDrawEpoch } from './subscribeToStore';
import { useStore } from '../store/store';
import { isLayerShown, shownLevelId } from '../store/selectors';
import type { DungeonLayer, Layer, UISlice } from '../store/types';
import { LightManager } from './lighting';
import type { GlowProp, RegionFace } from './lighting/LightManager';
import { renderToolPreview } from './toolPreview';
import { renderRoomHighlight } from './roomHighlight';
import { renderChildHoverHighlight } from './childHoverHighlight';
import { renderWallNodeHandles } from './wallNodeOverlay';
import { renderShapeNodeHandles } from './shapeNodeOverlay';
import { authoredWallMarks } from './wallNodeRenderer';
import { recordFrame } from './fpsMetrics';
import { updateShadows } from './shadowPass';
import {
  setDisplayedSky,
  tableAllLit,
  tableRoomMoods,
  tableRoomMoodsVersion,
  tableWorld,
  tableWorldSnaps,
  worldFrame,
} from './worldOverride';
import { SkyEaser, type SkyFrame } from '../shared/sky';
import { levelMood, roomMood } from '../shared/regionGrade';
import { roomFace } from '../shared/roomUtils';
import { glowOf } from '../shared/propFields';
import { isFrozen } from '../shared/freeze';
import { getEditorDesk, setAuthoredLookHold, sheetColor } from './editorDesk';
import { computeMapFrame, type WorldBounds } from '../shared/mapBounds';

/** The canvas clear colour without a desk; matches `PixiRenderEngine`'s init. */
const VOID_COLOR = 0x0f100e;

/**
 * Set up the per-frame render loop via PixiJS Ticker.
 * Order: (1) sync camera, (2) update background, (3) rebuild dirty layers,
 * (4) lighting, (5) overlay updates.
 *
 * Dirty-flag strategy: layers are NOT re-rendered every frame.
 * Camera changes need zero layer redraw.
 */
type StoreState = ReturnType<typeof useStore.getState>;

/**
 * The sky this tick stands under — the campaign's where a surface installed one (the Table),
 * the map's own where none did (the Editor). One reader of `worldFrame`, which is this loop;
 * see `worldOverride`.
 */
const skyNow = (state: StoreState): SkyFrame =>
  worldFrame(state.mapSettings, state.ui.previewClock, state.ui.previewSky, state.ui.previewWeather);

/**
 * The shown level's regions (its own mood, then every room face with the mood its look chain
 * resolves to, the table's live room moods on top) and its glowing props, for the lighting
 * pass. Recomputed only when one of the inputs is a new object.
 */
function regionsFeeder(lightManager: LightManager) {
  let refs: unknown[] = [];
  return (state: StoreState, layers: DungeonLayer[]): void => {
    const next = [
      layers,
      state.levels,
      state.mapSettings.ambientLight,
      state.mapSettings.environment,
      state.ui.activeLevelId,
      tableRoomMoodsVersion(),
    ];
    if (next.length === refs.length && next.every((v, i) => v === refs[i])) return;
    refs = next;
    const level = (state.levels ?? []).find((l) => l.id === shownLevelId(state));
    const levelMoodNow = levelMood(state.mapSettings, level);
    const live = tableRoomMoods();
    const rooms: RegionFace[] = [];
    const parts: string[] = [`${levelMoodNow.mood}:${levelMoodNow.moodTint}:${levelMoodNow.moodVision}`];
    const glows: GlowProp[] = [];
    const glowParts: string[] = [];
    for (const layer of layers) {
      for (const room of layer.rooms ?? []) {
        const face = roomFace(room);
        if (face.length < 3) continue;
        const mood = roomMood(state, layer, room);
        const override = live?.[room.id];
        const resolved = override ? { ...mood, mood: override } : mood;
        rooms.push({ id: room.id, face, mood: resolved });
        parts.push(`${room.id}:${resolved.mood}:${resolved.moodTint}:${face.length}:${face[0]![0]},${face[0]![1]}`);
      }
      for (const c of layer.children) {
        if (c.childType !== 'asset' || !c.visible) continue;
        const glow = glowOf(c);
        if (!glow) continue;
        glows.push({ prop: c, strength: glow.strength, animation: glow.animation });
        glowParts.push(
          `${c.id}|${c.assetId}|${c.position.x}|${c.position.y}|${c.width * c.scale}|${c.height * c.scale}|${c.rotation}|${c.flipX}|${c.flipY}|${glow.strength}|${glow.animation?.kind ?? ''}${glow.animation?.speed ?? ''}`,
        );
      }
    }
    lightManager.setRegions({ level: levelMoodNow, rooms, key: parts.join(',') });
    lightManager.setGlows(glows, glowParts.join(','));
  };
}

export function setupRenderLoop(
  engine: RenderEngine,
  sceneGraph: SceneGraph,
  lightManager: LightManager,
): void {
  // Background solid color fill — rendered once, updated when color changes
  const bgFill = new Graphics();
  bgFill.label = 'bgFill';
  sceneGraph.backgroundLayer.addChild(bgFill);

  // What the lighting falls on: everything drawn, never the solid fill under it. A background
  // texture and painted terrain are drawn ground and take the light; the fill, the grid and
  // the editing overlays do not. `contentRev` bumps on the store changes that change what is
  // drawn; the deferred layer flush, a background texture landing and the painted ground
  // changing (a stroke, or a map's splats decoding after the load) count as well.
  let contentRev = 0;
  sceneGraph.lightingRenderer.setContent({
    root: engine.stage(),
    content: [
      sceneGraph.backgroundLayer,
      sceneGraph.terrainRenderer.container,
      sceneGraph.layerContainer,
      sceneGraph.overheadContainer,
    ],
    exclude: [bgFill],
    revision: () =>
      `${contentRev}|${layerDrawEpoch()}|${sceneGraph.backgroundLayer.children.length}|${sceneGraph.terrainRenderer.revision()}`,
  });

  // Expose a way to mark background dirty (called by store subscription)
  (sceneGraph.backgroundLayer as SceneGraph['backgroundLayer'] & { _markDirty: () => void })._markDirty = () => {
    // no-op: background redraws every frame to cover viewport after zoom/pan
  };

  const stage = engine.stage();
  const feedRegions = regionsFeeder(lightManager);
  const easer = new SkyEaser();

  // The map's frame, for a host that lays the map on its own desk (`editorDesk`).
  let frameLayersRef: Layer[] | null = null;
  let frameTerrainRef: unknown = undefined;
  let frameFixedRef: unknown = undefined;
  let frame: WorldBounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  const mapFrame = (state: ReturnType<typeof useStore.getState>): WorldBounds => {
    const terrain = state.mapSettings.terrain?.bounds ?? null;
    const fixed = state.mapSettings.fixedSize ?? null;
    if (state.layers !== frameLayersRef || terrain !== frameTerrainRef || fixed !== frameFixedRef) {
      frameLayersRef = state.layers;
      frameTerrainRef = terrain;
      frameFixedRef = fixed;
      frame = computeMapFrame(state.layers, terrain, fixed) ?? { minX: -5, minY: -5, maxX: 5, maxY: 5 };
    }
    return frame;
  };

  // World containers held to a rect while a desk is installed. The sheet (background colour
  // and texture) is held to the map's frame, so the desk's clear colour shows around it. The
  // grid is not held: it runs on across desk and sheet, as it does without a desk. Nothing
  // drawn is held either — the frame always encloses everything drawn (a pinned map's frame
  // grows past the pin to take in whatever crosses it; see `computeMapFrame`), so the sheet
  // is always under all of it and there is nothing to cut. One mask per container, because
  // Pixi restores a mask's render flags when any one holder lets go of it, and a shared mask
  // could then start drawing itself.
  const makeClip = (targets: Container[], label: string) => {
    let masks: Graphics[] | null = null;
    let lastKey = '';
    return (rect: WorldBounds | null): void => {
      const key = rect ? `${rect.minX},${rect.minY},${rect.maxX},${rect.maxY}` : '';
      if (key === lastKey) return;
      lastKey = key;
      if (!rect) {
        for (const target of targets) target.mask = null;
        for (const g of masks ?? []) g.destroy();
        masks = null;
        return;
      }
      if (!masks) {
        masks = targets.map((target) => {
          const g = new Graphics();
          g.label = label;
          stage.addChild(g);
          target.mask = g;
          return g;
        });
      }
      for (const g of masks) {
        g.clear();
        g.rect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
        g.fill(0xffffff);
      }
    };
  };
  const applySheetClip = makeClip([sceneGraph.backgroundLayer], 'sheetClip');

  // What the map looks like as authored, kept up to date by the tick below; the export
  // asks for it back for the length of its render (`holdAuthoredLook`).
  let authoredBgTint = 0x0f100e;
  let liveBgTint = 0x0f100e;
  let liveDotColor: number | null = null;
  let liveClear = VOID_COLOR;
  let deskWasOn = false;
  setAuthoredLookHold(({ lit }) => {
    const renderer = engine.renderer();
    // A file keeps the authored background, lit or not (the lighting leaves it alone); an
    // unlit file keeps the grid dots the unlit editing view shows.
    bgFill.tint = authoredBgTint;
    renderer.background.color = VOID_COLOR;
    sceneGraph.gridRenderer.setDotColor(lit ? null : liveDotColor);
    applySheetClip(null);
    // Walls that let light through are drawn lighter on the desk; the file gets them as authored.
    const wallMarks = [...getLayerEntries().values()].flatMap((e) =>
      e.sublayers ? [authoredWallMarks(e.sublayers.wallMarks)] : [],
    );
    return () => {
      for (const release of wallMarks) release();
      bgFill.tint = liveBgTint;
      renderer.background.color = liveClear;
      sceneGraph.gridRenderer.setDotColor(liveDotColor);
      // The next tick puts the masks back; nothing renders before it does.
    };
  });

  // Background camera-change guard — skip redraw when camera+viewport+color unchanged
  let lastBgCamX = NaN;
  let lastBgCamY = NaN;
  let lastBgZoom = NaN;
  let lastBgW = NaN;
  let lastBgH = NaN;

  // Cached dungeon layer filter — avoids re-allocating array every frame.
  // Keyed on both the layers array and solo: solo toggling never touches
  // `layers` (see ui.ts's `toggleSoloLayer`), so without the second key a
  // solo/un-solo would never bust this cache and occlusion would keep
  // casting against a soloed-away layer's walls.
  let cachedLayersRef: Layer[] | null = null;
  let cachedSoloRef: UISlice['solo'] | null = null;
  let cachedLevelRef: string | null = null;
  let cachedDungeonLayers: DungeonLayer[] = [];

  // Access the PixiJS Ticker through the app
  // The ticker callback runs before each render
  let lastSplatRev = -1;
  const tickerCallback = () => {
    // (0) Record frame timestamp for FPS metrics
    recordFrame();

    // The sky this whole tick stands under. A table frame eases its darkness, weather and night
    // sky over FADE_MS; the Editor preview, a freeze and the DM slider drag land at once.
    const target = skyNow(useStore.getState());
    const frame = tableWorld()
      ? easer.step(target, performance.now(), isFrozen() || tableWorldSnaps())
      : easer.step(target, performance.now(), true);
    setDisplayedSky(frame);

    // (1) Camera sync — camera state lives on worldContainer directly,
    // mutated by useCanvasInput. Nothing to sync here.

    // (2) Update background — skip redraw when the camera is unchanged; the colour is a tint
    {
      const vp = engine.viewport();
      const zoom = stage.scale.x;
      const camX = stage.position.x;
      const camY = stage.position.y;
      const currentState = useStore.getState();
      const bgLayer = currentState.layers.find((l) => l.type === 'background');
      const desk = getEditorDesk();
      const unlit = desk !== null && !desk.lit;

      const authoredBg =
        bgLayer && bgLayer.type === 'background' ? bgLayer.backgroundColor : '#0f100e';
      // The solid fill is the map's empty ground: never lit, darkened or tinted by the hour.
      // The lighting composite leaves it alone (`setContent` below), so it shows as authored
      // at every hour, and on a desk as the desk's paper unless it is textured (`sheetColor`).
      authoredBgTint = parseInt(authoredBg.replace('#', ''), 16);
      liveBgTint = parseInt(sheetColor(currentState.layers, desk).replace('#', ''), 16);
      bgFill.tint = liveBgTint;

      if (
        camX !== lastBgCamX ||
        camY !== lastBgCamY ||
        zoom !== lastBgZoom ||
        vp.width !== lastBgW ||
        vp.height !== lastBgH
      ) {
        const worldLeft = -camX / zoom;
        const worldTop = -camY / zoom;
        const worldWidth = vp.width / zoom;
        const worldHeight = vp.height / zoom;

        // Over-size by 2x to handle panning without immediate redraws
        const pad = Math.max(worldWidth, worldHeight);
        bgFill.clear();
        bgFill.rect(
          worldLeft - pad,
          worldTop - pad,
          worldWidth + pad * 2,
          worldHeight + pad * 2,
        );
        // White, tinted above, so a colour change needs no redraw.
        bgFill.fill(0xffffff);

        lastBgCamX = camX;
        lastBgCamY = camY;
        lastBgZoom = zoom;
        lastBgW = vp.width;
        lastBgH = vp.height;
      }

      // (2a) On a desk: the canvas clears to the desk colour, the sheet is held to the map's
      // frame, the one grid takes the desk's dot colour everywhere, and the grade is held to
      // the frame too, or skipped while the sheet is unlit. The frame encloses everything
      // drawn, so neither hold ever cuts or unlights a stroke of the map.
      if (desk) {
        const renderer = engine.renderer();
        liveClear = parseInt(desk.desk.replace('#', ''), 16);
        if (renderer.background.color.toNumber() !== liveClear) renderer.background.color = liveClear;
        deskWasOn = true;
        const f = mapFrame(currentState);
        applySheetClip(f);
        liveDotColor = parseInt(desk.dot.replace('#', ''), 16);
        sceneGraph.gridRenderer.setDotColor(liveDotColor);
        sceneGraph.lightingRenderer.setLiveComposite(!unlit);
        const tl = engine.worldToScreen(f.minX, f.minY);
        const br = engine.worldToScreen(f.maxX, f.maxY);
        sceneGraph.lightingRenderer.setClip({
          x: Math.round(tl.x),
          y: Math.round(tl.y),
          width: Math.round(br.x) - Math.round(tl.x),
          height: Math.round(br.y) - Math.round(tl.y),
        });
      } else if (deskWasOn) {
        deskWasOn = false;
        liveClear = VOID_COLOR;
        engine.renderer().background.color = VOID_COLOR;
        applySheetClip(null);
        liveDotColor = null;
        sceneGraph.gridRenderer.setDotColor(null);
        sceneGraph.lightingRenderer.setLiveComposite(true);
        sceneGraph.lightingRenderer.setClip(null);
      }
    }

    // (3) Clear dirty flags on layer entries
    // RenderTexture pipeline deferred to Sprint 4+ — layers render directly
    const entries = getLayerEntries();
    for (const entry of entries.values()) {
      entry.dirtyFlag = false;
    }

    // (4) Grid update — redraws only when viewport range changes
    sceneGraph.gridRenderer.update(engine);

    // (4a) Fixed-size map boundary — editor-only (null at the table), and
    // no-ops unless the frame moved on screen. It traces the measured frame, not the
    // pinned size, so it moves out with anything drawn past the pin.
    if (sceneGraph.mapBoundaryRenderer) {
      sceneGraph.mapBoundaryRenderer.update(engine, mapFrame(useStore.getState()));
    }

    // (4b) Terrain crisp-window settle check — re-bakes the viewport window
    // only once the camera (or a paint stroke) has been still for a beat.
    sceneGraph.terrainRenderer.update(engine);

    // (5) Tool preview update
    sceneGraph.toolManager.updatePreview();

    // (5b) Tool settings preview — ghost shape from popover edits
    {
      const vp = engine.viewport();
      const previewZoom = stage.scale.x;
      const previewCx = (-stage.position.x + vp.width / 2) / previewZoom;
      const previewCy = (-stage.position.y + vp.height / 2) / previewZoom;
      renderToolPreview(previewCx, previewCy, previewZoom);
    }

    // (5c) Room highlight — no-ops unless the highlighted room changed
    renderRoomHighlight();

    // (5c') Layer-panel child hover — no-ops unless the hovered child changed
    renderChildHoverHighlight();

    // (5d) Wall node handles — no-ops unless the edited wall, selection, zoom
    // or camera changed. Zoom matters: handles are drawn at a constant screen
    // size. Camera matters: edit mode dims the rest of the view with a quad
    // covering the camera's world rect.
    const nodeVp = engine.viewport();
    const nodeZoom = stage.scale.x;
    const nodeView = {
      x: -stage.position.x / nodeZoom,
      y: -stage.position.y / nodeZoom,
      width: nodeVp.width / nodeZoom,
      height: nodeVp.height / nodeZoom,
    };
    renderWallNodeHandles(nodeZoom, nodeView);
    renderShapeNodeHandles(nodeZoom, nodeView);

    // (6) Lighting — rebuild wall segments if dirty, update FBO
    const storeState = useStore.getState();
    // Shown layers only: visible, narrowed by solo and by the shown level — another level's
    // walls, lights, props and shadows are not this level's.
    if (
      storeState.layers !== cachedLayersRef ||
      storeState.ui.solo !== cachedSoloRef ||
      storeState.ui.activeLevelId !== cachedLevelRef
    ) {
      cachedLayersRef = storeState.layers;
      cachedSoloRef = storeState.ui.solo;
      cachedLevelRef = storeState.ui.activeLevelId;
      contentRev++;
      cachedDungeonLayers = storeState.layers.filter(
        (l): l is DungeonLayer => l.type === 'dungeon' && isLayerShown(storeState, l),
      );
    }
    lightManager.rebuildIfDirty(cachedDungeonLayers);
    feedRegions(storeState, cachedDungeonLayers);

    // (6b) Directional shadows (P3a) — the sun's own pass, over the same wall set the sweep
    // above was just rebuilt from. Memoized on (wall epoch, sun step, orientation, sky): an
    // unedited map under a paused clock costs one string compare per layer here.
    updateShadows(cachedDungeonLayers, lightManager.getWallEpoch(), frame);

    // Get camera state for UV → world transform in shader
    const zoom = stage.scale.x;
    const camX = -stage.position.x / zoom;
    const camY = -stage.position.y / zoom;

    // The sky: the renderer composes the per-region grade mask from it. Both surfaces come
    // through here — the Table by installing its campaign sky (`setTableWorld`), the Editor by
    // installing nothing and falling through to the scrub head. One writer.
    sceneGraph.lightingRenderer.setSky(frame, { allLit: tableAllLit() });

    // A map load must force one recomposite even when the loaded ambient and
    // light list coincide with the pre-load defaults the first frames were
    // drawn from — terrainSplats.rev bumps on every loadFromFile (and on
    // splat edits, whose recomposite is wanted anyway).
    if (storeState.terrainSplats.rev !== lastSplatRev) {
      lastSplatRev = storeState.terrainSplats.rev;
      sceneGraph.lightingRenderer.invalidate();
    }

    sceneGraph.lightingRenderer.updateAndRender(
      lightManager,
      camX,
      camY,
      zoom,
      storeState.mapSettings.ambientLight,
    );

    // (7) Overlay updates — sync transform gizmo screen position
    sceneGraph.toolManager.updateGizmo();
  };

  engine.addTickerCallback(tickerCallback);
}
