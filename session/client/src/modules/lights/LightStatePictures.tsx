// A brazier's state at the table, as its own pictures: Off, Embers and On, each tile the prop's
// art for that state with its name under it, the one in use outlined (the shared Tile).

import { useEffect, useRef } from 'react';
import { load, resolveTexture } from '@dnd/core/src/assets/textureLoader';
import type { LightState, LightStates } from '@dnd/core/src/shared/propLights';
import { Tile } from '@dnd/ui';

type Tex = ReturnType<typeof resolveTexture>;

/** The texture's frame, fitted whole into the canvas. */
function draw(canvas: HTMLCanvasElement, tex: Tex): void {
  const source = tex.source?.resource as CanvasImageSource | undefined;
  if (!source) return;
  const f = tex.frame;
  const size = Math.min(96, Math.max(f.width, f.height));
  const scale = size / Math.max(f.width, f.height);
  canvas.width = Math.max(1, Math.round(f.width * scale));
  canvas.height = Math.max(1, Math.round(f.height * scale));
  canvas.getContext('2d')?.drawImage(source, f.x, f.y, f.width, f.height, 0, 0, canvas.width, canvas.height);
}

/** One pack picture, drawn when its texture is there (and again once it lands). */
function Picture({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const tex = resolveTexture(id);
    if (tex.width > 1) {
      draw(canvas, tex);
      return;
    }
    let live = true;
    void load(id).then((loaded) => {
      if (live && loaded.width > 1 && ref.current) draw(ref.current, loaded);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return <canvas ref={ref} className="h-full w-full object-contain" />;
}

const LABEL: Record<LightState, string> = { off: 'Off', embers: 'Embers', on: 'On' };

export function LightStatePictures({
  states,
  value,
  onPick,
}: {
  states: LightStates;
  value: LightState | 'mixed';
  onPick: (state: LightState) => void;
}) {
  return (
    <div role="group" aria-label="Light state" className="flex gap-1.5" data-testid="light-state">
      {(['off', 'embers', 'on'] as const)
        .filter((s) => states[s])
        .map((s) => (
          <Tile key={s} name={LABEL[s]} aria-label={LABEL[s]} active={s === value} data-state={s} onClick={() => s !== value && onPick(s)}>
            <Picture id={states[s]!} />
          </Tile>
        ))}
    </div>
  );
}
