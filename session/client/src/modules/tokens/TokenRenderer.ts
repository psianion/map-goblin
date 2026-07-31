// §2.4.5 — the token overlay: one Pixi container in `worldContainer`, right above the
// map layers, holding one sprite per token in the active scene.
//
// D1: tokens are session state, not map content, so nothing here touches the core store —
// the layer reads the tokens module slice off the session store and reconciles.

// ponytail: pixi is @dnd/core's dependency, not this package's — reaching through core
// is one import specifier instead of a second manifest entry + lockfile churn, and it
// guarantees the same module instance the engine itself booted with. Swap it for a plain
// `'pixi.js'` the day session-client declares the dep.
import { Container, Graphics, Sprite, Text, Texture, type Ticker } from 'pixi.js';
import { SIZE_CELLS, type Disposition, type Token, type TokensState } from '@dnd/mechanics/tokens';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { endpoints } from '../../endpoints';
import { addWorldOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { approach, attachTokenInput, drawOrder, useTokenInteraction, type TokenLayer } from './drag';

/** D11 — friendly green, neutral yellow, hostile red. */
export const DISPOSITION_COLOR: Record<Disposition, number> = {
  friendly: 0x4ade80,
  neutral: 0xfacc15,
  hostile: 0xf87171,
};

/** "Goblin Boss" → "GB"; one word → its first two letters; nothing usable → "?". */
export function initials(name: string): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/** The active scene's tokens out of a (wire-supplied, therefore untrusted) module slice. */
export function tokensOf(state: TokensState | undefined, sceneId: string | null | undefined): Token[] {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  if (!scene || typeof scene !== 'object') return [];
  return Object.values(scene).filter(
    (t): t is Token => !!t && typeof t.x === 'number' && typeof t.y === 'number',
  );
}

function activeTokens(): Token[] {
  const session = useSessionStore.getState().session;
  return tokensOf(session?.modules?.tokens as TokensState | undefined, session?.activeSceneId);
}

const ownerName = (ownerId: string | null): string | null =>
  useSessionStore.getState().session?.players.find((p) => p.identityId === ownerId)?.name ?? null;

// ─── Portrait textures ──────────────────────────────────────
// GET /api/assets/:id needs the session token in a header, so this is a fetch + decode
// rather than `Assets.load(url)`. Cached per asset id for the tab's lifetime: ids are
// random and an asset is never rewritten (D11), so a cached texture can never be stale.
const textures = new Map<string, Promise<Texture | null>>();

async function fetchTexture(assetId: string): Promise<Texture | null> {
  const token = useSessionStore.getState().token;
  const res = await fetch(`${endpoints.httpBase}/api/assets/${encodeURIComponent(assetId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  return Texture.from(await createImageBitmap(await res.blob()));
}

function loadTexture(assetId: string): Promise<Texture | null> {
  let pending = textures.get(assetId);
  if (!pending) {
    pending = fetchTexture(assetId).catch(() => null);
    textures.set(assetId, pending);
  }
  return pending;
}

// ─── One token's display objects ────────────────────────────

interface View {
  container: Container;
  outline: Graphics;
  token: Token;
  /** Everything but position; a change rebuilds the sprite. */
  sig: string;
  /** Where the sprite is heading; the ticker eases towards it. */
  target: { x: number; y: number };
  dragging: boolean;
  /** Position we dropped at, awaiting the server's echo (D9 reconcile). */
  pending: { x: number; y: number; until: number } | null;
}

const signature = (t: Token, isDm: boolean): string =>
  [t.name, t.size, t.disposition, t.imageAssetId, t.hidden, t.ownerId, ownerName(t.ownerId), isDm].join('|');

/**
 * How a token draws for the viewer. The alpha is here so it can be pinned: PRODUCT
 * principle 3 says a hidden token on the DM's map is drawn at full strength with a badge,
 * never faded — Owlbear's ghosting is the anti-reference the whole redaction model exists
 * to refuse. Players never receive a hidden token at all (D4), so the badge is the DM's.
 */
export function tokenAppearance(token: Token, isDm: boolean): { alpha: number; badge: 'hidden' | null } {
  return { alpha: 1, badge: isDm && token.hidden ? 'hidden' : null };
}

function buildView(token: Token, isDm: boolean): View {
  const cells = SIZE_CELLS[token.size] ?? 1;
  const r = cells / 2;
  const color = DISPOSITION_COLOR[token.disposition] ?? DISPOSITION_COLOR.neutral;
  const container = new Container();
  container.label = `token-${token.id}`;

  const disc = new Graphics().circle(0, 0, r).fill({ color: 0x111827 });
  container.addChild(disc);

  if (token.imageAssetId) {
    const mask = new Graphics().circle(0, 0, r).fill({ color: 0xffffff });
    container.addChild(mask);
    void loadTexture(token.imageAssetId).then((texture) => {
      if (!texture || container.destroyed) return;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      // Cover the disc, then clip to it.
      sprite.scale.set((r * 2) / Math.max(1, Math.min(texture.width, texture.height)));
      sprite.mask = mask;
      container.addChildAt(sprite, 1);
    });
  } else {
    const text = new Text({
      text: initials(token.name),
      style: { fill: 0xffffff, fontFamily: 'sans-serif', fontSize: 48, fontWeight: 'bold' },
    });
    text.anchor.set(0.5);
    text.scale.set((r * 0.9) / (text.height || 48));
    container.addChild(text);
  }

  // Disposition ring, and a white inner ring when someone has claimed it.
  container.addChild(new Graphics().circle(0, 0, r).stroke({ width: r * 0.16, color }));
  if (token.ownerId) {
    container.addChild(new Graphics().circle(0, 0, r * 0.86).stroke({ width: r * 0.07, color: 0xffffff }));
  }

  const look = tokenAppearance(token, isDm);
  container.alpha = look.alpha;
  if (look.badge === 'hidden') container.addChild(eyeSlash(r));

  const owner = ownerName(token.ownerId);
  const label = new Text({
    text: owner ? `${token.name} · ${owner}` : token.name,
    style: { fill: 0xe5e5e5, fontFamily: 'sans-serif', fontSize: 32 },
  });
  label.anchor.set(0.5, 0);
  label.scale.set(0.28 / (label.height || 32));
  label.position.set(0, r * 1.05);
  container.addChild(label);

  const outline = new Graphics().circle(0, 0, r * 1.18).stroke({ width: r * 0.08, color: 0xffffff });
  outline.visible = false;
  container.addChild(outline);

  container.position.set(token.x, token.y);
  return {
    container,
    outline,
    token,
    sig: signature(token, isDm),
    target: { x: token.x, y: token.y },
    dragging: false,
    pending: null,
  };
}

/** Eye-slash badge — "the players cannot see this one". */
function eyeSlash(r: number): Graphics {
  const s = r * 0.45;
  const stroke = { width: s * 0.22, color: 0xffffff } as const;
  const g = new Graphics();
  g.ellipse(0, 0, s, s * 0.6).stroke(stroke);
  g.circle(0, 0, s * 0.25).stroke(stroke);
  g.moveTo(-s, s * 0.7).lineTo(s, -s * 0.7).stroke(stroke);
  g.position.set(r * 0.8, -r * 0.8);
  return g;
}

// ─── Mount / unmount ────────────────────────────────────────

/** How long a dropped token waits for the server to agree before rubber-banding (D9). */
const SETTLE_MS = 600;

function mountTokenLayer(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  layer.sortableChildren = true;
  // Topmost of the world-space session overlays, so the DM's fog tint never draws over a
  // token (see `OVERLAY_STACK` — that ordering is PRODUCT principle 3 as a draw order).
  // Deliberately still under the *player's* mask, which is screen space: a token in a room
  // the party cannot see is hidden, and that is the mask doing its job.
  addWorldOverlay(sceneGraph, layer, 'tokenLayer');

  const views = new Map<string, View>();
  let tokens: Token[] = [];
  let lastSlice: unknown;
  let lastScene: string | null | undefined;
  let lastSelected: string | null | undefined;

  const drop = (view: View) => {
    if (!view.container.destroyed) view.container.destroy({ children: true });
  };

  const sync = () => {
    const { session, you } = useSessionStore.getState();
    const isDm = you?.role === 'dm';
    const selected = useTokenInteraction.getState().selectedId;
    tokens = activeTokens();

    const live = new Set<string>();
    for (const token of tokens) {
      live.add(token.id);
      let view = views.get(token.id);
      if (view && view.sig !== signature(token, isDm)) {
        drop(view);
        views.delete(token.id);
        view = undefined;
      }
      if (!view) {
        view = buildView(token, isDm);
        views.set(token.id, view);
        layer.addChild(view.container);
      }
      view.token = token;
      view.container.zIndex = drawOrder(token);
      view.outline.visible = token.id === selected;
      // §4: inbound positions never fight a drag in progress, and a just-dropped token
      // holds its optimistic spot until the server confirms (or SETTLE_MS expires).
      if (view.dragging) continue;
      if (view.pending) {
        if (token.x !== view.pending.x || token.y !== view.pending.y) continue;
        view.pending = null;
      }
      view.target.x = token.x;
      view.target.y = token.y;
    }
    for (const [id, view] of views) {
      if (live.has(id)) continue;
      drop(view);
      views.delete(id);
    }
    lastSlice = session?.modules?.tokens;
    lastScene = session?.activeSceneId;
    lastSelected = selected;
  };

  // The store fires on every ping too — only the three things this layer draws from
  // are worth a reconcile.
  const dirty = () => {
    const { session } = useSessionStore.getState();
    return (
      session?.modules?.tokens !== lastSlice ||
      session?.activeSceneId !== lastScene ||
      useTokenInteraction.getState().selectedId !== lastSelected
    );
  };
  const onChange = () => {
    if (dirty()) sync();
  };

  const tick = (ticker: Ticker) => {
    const now = Date.now();
    for (const view of views.values()) {
      if (view.pending && now > view.pending.until) {
        // No echo: the move was rejected (or lost). Rubber-band to the last state we
        // were actually told about.
        view.pending = null;
        view.target.x = view.token.x;
        view.target.y = view.token.y;
      }
      if (view.dragging) continue;
      const c = view.container;
      if (c.x === view.target.x && c.y === view.target.y) continue;
      c.x = approach(c.x, view.target.x, ticker.deltaMS);
      c.y = approach(c.y, view.target.y, ticker.deltaMS);
    }
  };

  const api: TokenLayer = {
    tokens: () => tokens,
    placeAt: (id, x, y) => {
      const view = views.get(id);
      if (!view) return;
      view.target.x = x;
      view.target.y = y;
      view.container.position.set(x, y);
    },
    setDragging: (id, dragging) => {
      const view = views.get(id);
      if (!view) return;
      view.dragging = dragging;
      if (!dragging) view.pending = { x: view.target.x, y: view.target.y, until: Date.now() + SETTLE_MS };
    },
  };

  const detachInput = attachTokenInput(engine, api);
  const unsubSession = useSessionStore.subscribe(onChange);
  const unsubUi = useTokenInteraction.subscribe(onChange);
  const ticker = engine.ticker();
  ticker.add(tick);
  sync();

  return () => {
    detachInput();
    unsubSession();
    unsubUi();
    // The engine may already be gone (GameRenderer unmounting first) — its objects are
    // destroyed, and touching them throws. Nothing left to clean up in that case.
    try {
      ticker.remove(tick);
      for (const view of views.values()) drop(view);
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
    views.clear();
  };
}

/**
 * §4 risk — the engine is booted asynchronously by GameRenderer and cleared when it
 * unmounts, so this layer waits for one rather than assuming it. Call from an effect; the
 * returned function is the effect's cleanup.
 */
export const mountTokenLayerWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountTokenLayer, pollMs);
