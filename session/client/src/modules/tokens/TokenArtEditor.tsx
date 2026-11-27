// The token picture editor (plan 3.4): a picture inside the token's circle, moved by drag and
// zoomed by wheel, pinch or slider, a ring colour, and the token as it reads on the map. Save
// draws the crop at 512 px, uploads it, and hands the asset id and ring to the caller, which
// sends `pc-update` or `library-upsert`. Used in the lobby, a player's own token card and the
// DM's Token type sheet.

import { useEffect, useRef, useState } from 'react';
import { PrimaryButton, SecondaryButton, SliderRow, Swatch, cn } from '@dnd/ui';
import { ImagePlus } from '@dnd/ui/icons';
import { notify } from '@dnd/ui/toast';
import { CENTRED, MAX_ZOOM, NO_RING, RING_COLOURS, clampCrop, coverRect, encodeArt, type Crop } from './artCrop';
import { usePortrait, uploadArt } from './portrait';
import { initials } from './TokenRenderer';

const VIEW_PX = 208;
/** A medium token at the table's opening zoom. */
const MAP_PX = 48;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const NO_RING_SLASH =
  'linear-gradient(to top right, transparent calc(50% - 0.75px), var(--text-3) calc(50% - 0.75px), var(--text-3) calc(50% + 0.75px), transparent calc(50% + 0.75px))';

export interface TokenArt {
  imageAssetId: string | null;
  ring: string;
}

interface Picture {
  url: string;
  img: HTMLImageElement;
}

/** The picture at `size`, cropped and ringed the way the map draws the token. */
function Disc({ picture, crop, ring, name, size, className }: { picture: Picture | null; crop: Crop; ring: string; name: string; size: number; className?: string }) {
  const r = picture ? coverRect(picture.img.naturalWidth, picture.img.naturalHeight, crop, size) : null;
  const ringed = ring !== NO_RING;
  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden rounded-pill bg-[#111827]', className)}
      style={{ width: size, height: size }}
    >
      {picture && r ? (
        <img
          src={picture.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
          style={{ width: r.w, height: r.h, transform: `translate(${r.x}px, ${r.y}px)` }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center font-semibold text-white" style={{ fontSize: size * 0.32 }}>
          {initials(name)}
        </span>
      )}
      {/* The map's two rings: the colour at the edge, the claimed seat's white just inside. */}
      {ringed && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-pill" style={{ boxShadow: `inset 0 0 0 ${Math.max(2, size * 0.06)}px ${ring}` }} />
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-pill"
            style={{ inset: size * 0.0525, boxShadow: `inset 0 0 0 ${Math.max(1, size * 0.035)}px #ffffff` }}
          />
        </>
      )}
    </span>
  );
}

export function TokenArtEditor({
  name,
  imageAssetId,
  ring: initialRing,
  defaultRing,
  onSave,
  onCancel,
}: {
  name: string;
  imageAssetId: string | null;
  /** The token's ring today; absent starts on `defaultRing`. */
  ring?: string;
  /** The seat's colour. */
  defaultRing: string;
  onSave: (art: TokenArt) => void;
  onCancel?: () => void;
}) {
  const current = usePortrait(imageAssetId);
  const [picked, setPicked] = useState<Picture | null>(null);
  const [loaded, setLoaded] = useState<Picture | null>(null);
  const [crop, setCrop] = useState<Crop>(CENTRED);
  const [ring, setRing] = useState(initialRing ?? defaultRing);
  // A new picture, or the old one moved: either way Save draws and uploads a new one.
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // The token's own picture, until another is chosen.
  useEffect(() => {
    if (!current) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live) setLoaded({ url: current, img });
    };
    img.src = current;
    return () => {
      live = false;
    };
  }, [current]);

  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked.url);
    },
    [picked],
  );

  const picture = picked ?? loaded;
  const move = (next: (c: Crop) => Crop) => {
    if (!picture) return;
    setCrop((c) => clampCrop(picture.img.naturalWidth, picture.img.naturalHeight, next(c)));
    setChanged(true);
  };

  // Wheel zoom needs a listener that may cancel the page's scroll; React's is passive.
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      moveRef.current((c) => ({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!TYPES.includes(file.type)) return void notify.error('Choose a PNG, JPEG or WebP picture.');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPicked({ url, img });
      setCrop(CENTRED);
      setChanged(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      notify.error('That picture could not be opened.');
    };
    img.src = url;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!picture) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const all = pointers.current;
    const was = all.get(e.pointerId);
    if (!was) return;
    const before = [...all.values()];
    all.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const after = [...all.values()];
    if (after.length === 1) {
      move((c) => ({ ...c, x: c.x + (e.clientX - was.x) / VIEW_PX, y: c.y + (e.clientY - was.y) / VIEW_PX }));
      return;
    }
    // Two fingers: the spread zooms, the midpoint pans.
    const spread = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
    const mid = (p: { x: number; y: number }[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
    const k = spread(after) / spread(before);
    const m0 = mid(before);
    const m1 = mid(after);
    move((c) => ({ zoom: c.zoom * k, x: c.x + (m1.x - m0.x) / VIEW_PX, y: c.y + (m1.y - m0.y) / VIEW_PX }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const save = async () => {
    setSaving(true);
    try {
      const id = changed && picture ? await uploadArt(await encodeArt(picture.img, crop)) : imageAssetId;
      onSave({ imageAssetId: id, ring });
      setChanged(false);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'That picture could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex w-full max-w-[320px] flex-col gap-3" data-testid="token-art-editor">
      <div className="flex flex-col items-center gap-2">
        <div
          ref={viewRef}
          role="img"
          aria-label={picture ? 'Token picture. Drag to move it, scroll or pinch to zoom.' : 'No picture yet'}
          data-testid="token-art-view"
          className={cn('touch-none rounded-pill', picture ? 'cursor-grab active:cursor-grabbing' : '')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <Disc picture={picture} crop={crop} ring={ring} name={name} size={VIEW_PX} className="shadow-e" />
        </div>
        <span className="text-[11px] text-text-3">
          {picture ? 'Drag to move. Scroll or pinch to zoom.' : 'PNG, JPEG or WebP.'}
        </span>
      </div>

      <SliderRow
        label="Zoom"
        className="w-full"
        value={crop.zoom}
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        disabled={!picture}
        format={(z) => `${Math.round(z * 100)}%`}
        onValueChange={(zoom) => move((c) => ({ ...c, zoom }))}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-text-2">Ring</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ring colour">
          {RING_COLOURS.map((c) => (
            <Swatch
              key={c}
              color={c}
              label={`Ring ${c}`}
              aria-pressed={ring === c}
              data-testid={`token-art-ring-${c.slice(1)}`}
              className={cn('rounded-pill', ring === c && 'ring-[1.5px] ring-ink ring-offset-2 ring-offset-panel')}
              onClick={() => setRing(c)}
            />
          ))}
          <Swatch
            label="No ring"
            aria-pressed={ring === NO_RING}
            data-testid="token-art-ring-none"
            className={cn('rounded-pill', ring === NO_RING && 'ring-[1.5px] ring-ink ring-offset-2 ring-offset-panel')}
            style={{ backgroundImage: NO_RING_SLASH }}
            onClick={() => setRing(NO_RING)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="flex size-[72px] shrink-0 items-center justify-center rounded-float border border-line bg-panel-2"
          style={{ backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)', backgroundSize: '24px 24px', backgroundPosition: '-1px -1px' }}
          data-testid="token-art-preview"
          title="On the map"
        >
          <Disc picture={picture} crop={crop} ring={ring} name={name} size={MAP_PX} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] text-text-2">On the map</span>
          <SecondaryButton icon={ImagePlus} disabled={saving} data-testid="token-art-pick" onClick={() => fileRef.current?.click()}>
            {picture ? 'Choose another picture' : 'Choose a picture'}
          </SecondaryButton>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={TYPES.join(',')}
          className="hidden"
          data-testid="token-art-file"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex justify-end gap-1.5">
        {onCancel && (
          <SecondaryButton disabled={saving} onClick={onCancel}>
            Cancel
          </SecondaryButton>
        )}
        <PrimaryButton disabled={saving} data-testid="token-art-save" onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
      </div>
    </div>
  );
}
