import { useState } from 'react';
import type { StoryState } from '@dnd/mechanics/story';
import { Button, FloatBox, cn } from '@dnd/ui';
import { usePortraitUrl } from '../../shell/portrait';
import { useModuleState, useRole } from '../../session/store';

/**
 * What the DM shows players (4.3 Story): the handout as a card or full screen, the title card
 * over the map or full screen. Each has Hide for me, which only puts it away on this seat.
 */
export function StoryOverlay() {
  const role = useRole();
  const story = useModuleState<StoryState>('story');
  const [hidden, setHidden] = useState<{ handout: string | null; title: number | null }>({ handout: null, title: null });
  const shown = story?.shown ?? null;
  const handout = shown ? story?.handouts.find((h) => h.id === shown.handoutId) : undefined;
  const image = usePortraitUrl(handout?.assetId ?? null);
  if (role !== 'player' || !story) return null;
  const handoutKey = shown ? `${shown.handoutId}:${shown.mode}` : null;
  const title = story.titleCard;

  return (
    <>
      {handout && shown && hidden.handout !== handoutKey && (
        <div
          className={cn('absolute z-40 flex items-center justify-center', shown.mode === 'full' ? 'inset-0 bg-bg/90' : 'top-16 left-1/2 -translate-x-1/2')}
          data-testid="story-handout"
          data-mode={shown.mode}
        >
          <FloatBox className={cn('flex flex-col gap-2 p-4', shown.mode === 'full' ? 'max-h-full w-full max-w-2xl overflow-y-auto' : 'w-96')}>
            <span className="text-sm font-medium text-text">{handout.caption}</span>
            {image && <img src={image} alt={handout.caption} className="max-h-96 w-full rounded-control object-contain" />}
            {handout.text && <p className="text-sm whitespace-pre-wrap text-text-2">{handout.text}</p>}
            {handout.from && <span className="text-xs text-text-3">{handout.from}</span>}
            <Button variant="ghost" size="sm" className="self-end" data-testid="story-hide-for-me" onClick={() => setHidden((h) => ({ ...h, handout: handoutKey }))}>
              Hide for me
            </Button>
          </FloatBox>
        </div>
      )}
      {title && hidden.title !== title.shownAt && (
        <div
          className={cn('absolute z-40 flex items-center justify-center', title.mode === 'full' ? 'inset-0 bg-bg' : 'inset-x-0 top-1/3')}
          data-testid="story-title-card"
          data-mode={title.mode}
        >
          <div className="flex flex-col items-center gap-3">
            <h2 className="text-center text-3xl font-medium text-text">{title.text}</h2>
            <Button variant="ghost" size="sm" onClick={() => setHidden((h) => ({ ...h, title: title.shownAt }))}>
              Hide for me
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
