import { useMemo, useRef, useState } from 'react';
import { roomLabel } from '@dnd/core/src/shared/prep';
import type { Handout, StoryState } from '@dnd/mechanics/story';
import { Button, Caption, Chip, Input, PrimaryButton, Seg } from '@dnd/ui';
import { notify } from '@dnd/ui/toast';
import { useModuleState, useSessionStore } from '../../session/store';
import { usePortraitUrl } from '../../shell/portrait';
import { withoutSupersededSeats } from '../../shell/top/roster';
import { uploadArt } from '../tokens/portrait';
import { useMapRooms, useScenePrep } from '../triggers/scenePrep';
import { currentAudience, useStoryAudience } from './audience';

const send = (action: string, payload: unknown): void => useSessionStore.getState().sendCommand('story', action, payload);

const EMPTY: StoryState = { handouts: [], shown: null, titleCard: null, journal: [] };

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function useStory(): StoryState {
  return useModuleState<StoryState>('story') ?? EMPTY;
}

/** Board 17, left: audience, the title card, a room's read-aloud with Share, the journal. */
export function StoryBody() {
  const story = useStory();
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = withoutSupersededSeats(roster).filter((p) => p.role === 'player');
  const audience = useStoryAudience();
  const setAudience = (next: Partial<ReturnType<typeof useStoryAudience.getState>>): void => useStoryAudience.setState(next);
  const [title, setTitle] = useState('');
  const [titleMode, setTitleMode] = useState<'over' | 'full'>('over');
  const { prep } = useScenePrep();
  const rooms = useMapRooms();
  const keyed = useMemo(() => (prep?.rooms ?? []).filter((k) => k.readAloud.trim()), [prep]);
  const [roomId, setRoomId] = useState('');
  const room = keyed.find((k) => k.roomId === roomId) ?? keyed[0];
  const nameOf = (id: string): string => {
    const r = rooms.get(id);
    return (r && roomLabel(r)) || 'Room';
  };
  const handoutName = (id: string): string => story.handouts.find((h) => h.id === id)?.caption ?? 'Handout';

  return (
    <div className="flex flex-col gap-2.5" data-testid="story-body">
      <section className="flex flex-col gap-1">
        <Caption>Show to players</Caption>
        <Seg
          aria-label="Audience"
          options={[
            { value: 'all', label: 'Everyone', testId: 'story-audience-all' },
            { value: 'chosen', label: 'Chosen', testId: 'story-audience-chosen' },
          ]}
          value={audience.mode}
          onValueChange={(v) => setAudience({ mode: v as 'all' | 'chosen' })}
        />
        {audience.mode === 'chosen' && (
          <div className="flex flex-wrap gap-1">
            {players.length === 0 && <span className="text-xs text-text-3">No players yet.</span>}
            {players.map((p) => (
              <Chip
                key={p.identityId}
                pressed={audience.chosen.includes(p.identityId)}
                onPressedChange={(on) =>
                  setAudience({ chosen: on ? [...audience.chosen, p.identityId] : audience.chosen.filter((id) => id !== p.identityId) })
                }
              >
                {p.name}
              </Chip>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <Caption>Title card</Caption>
        <Input value={title} placeholder="Chapter two: The Web Gallery" aria-label="Title card" data-testid="story-title" onChange={(e) => setTitle(e.target.value)} />
        <Seg
          aria-label="Title card mode"
          options={[
            { value: 'over', label: 'Over map' },
            { value: 'full', label: 'Full screen' },
          ]}
          value={titleMode}
          onValueChange={(v) => setTitleMode(v as 'over' | 'full')}
        />
        <div className="flex gap-1">
          <PrimaryButton className="h-6 px-2.5 text-xs" disabled={!title.trim()} data-testid="story-title-show" onClick={() => send('title-show', { text: title.trim(), mode: titleMode })}>
            Show
          </PrimaryButton>
          <Button variant="outline" size="sm" disabled={!story.titleCard} data-testid="story-title-hide" onClick={() => send('title-hide', {})}>
            Hide
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <Caption>Read-aloud</Caption>
        {keyed.length === 0 ? (
          <p className="text-xs text-text-3">No room on this scene has read-aloud text.</p>
        ) : (
          <>
            <select
              aria-label="Room"
              data-testid="story-room"
              className="h-7 rounded-control border border-line bg-panel px-1.5 text-xs text-text"
              value={room?.roomId ?? ''}
              onChange={(e) => setRoomId(e.target.value)}
            >
              {keyed.map((k) => (
                <option key={k.roomId} value={k.roomId}>
                  {nameOf(k.roomId)}
                </option>
              ))}
            </select>
            {room && <p className="line-clamp-3 border-l-2 border-line-strong pl-2 text-xs whitespace-pre-wrap text-text-2">{room.readAloud}</p>}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              data-testid="story-share"
              disabled={!room}
              onClick={() => room && send('share-readaloud', { roomId: room.roomId, ...(sceneId ? { sceneId } : {}) })}
            >
              Share
            </Button>
          </>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <Caption>Journal</Caption>
        <ul className="flex flex-col gap-0.5 text-xs text-text-2" data-testid="story-journal">
          {story.journal.length === 0 && <li className="text-text-3">Nothing shared yet.</li>}
          {[...story.journal].reverse().map((j) => (
            <li key={j.id} className="flex gap-2">
              <time className="font-mono text-text-3">{clock(j.sharedAt)}</time>
              <span className="truncate">
                {j.kind === 'handout' ? handoutName(j.ref) : j.kind === 'readaloud' ? `Read-aloud · ${nameOf(j.ref)}` : `Title · ${j.ref}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A handout picture at thumbnail size; nothing while it loads or when there is none. */
function HandoutThumb({ assetId, alt }: { assetId: string | undefined; alt: string }) {
  const url = usePortraitUrl(assetId ?? null);
  if (!url) return null;
  return <img src={url} alt={alt} data-testid="handout-thumb" className="h-16 w-full rounded-control object-cover" />;
}

function HandoutCard({ h, shown }: { h: Handout; shown: StoryState['shown'] }) {
  const isShown = shown?.handoutId === h.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <li className="flex w-40 shrink-0 flex-col gap-1 rounded-control border border-line p-1.5" data-testid="handout-card" data-shown={isShown || undefined}>
      <HandoutThumb assetId={h.assetId} alt={h.caption} />
      <span className="truncate text-xs text-text">{h.caption}</span>
      {h.text && <span className="line-clamp-2 text-xs text-text-3">{h.text}</span>}
      {confirmDelete ? (
        <div className="flex flex-wrap gap-1" data-testid="handout-delete-confirm">
          <Button variant="destructive" size="xs" data-testid="handout-delete-yes" onClick={() => send('handout-delete', { id: h.id })}>
            Delete
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="xs" data-testid="handout-show" onClick={() => send('show', { handoutId: h.id, audience: currentAudience(), mode: 'card' })}>
            Show
          </Button>
          <Button variant="outline" size="xs" data-testid="handout-full" onClick={() => send('show', { handoutId: h.id, audience: currentAudience(), mode: 'full' })}>
            Full screen
          </Button>
          {isShown && (
            <Button variant="ghost" size="xs" data-testid="handout-hide" onClick={() => send('hide', {})}>
              Hide
            </Button>
          )}
          <Button variant="ghost" size="xs" data-testid="handout-delete" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

/** Board 17, right: the handouts with Add, Show and Hide. */
export function StoryStrip() {
  const story = useStory();
  const [adding, setAdding] = useState(false);
  const [caption, setCaption] = useState('');
  const [text, setText] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = !!caption.trim() && (!!text.trim() || !!assetId) && !uploading;
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      setAssetId(await uploadArt(file));
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'That picture could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="flex gap-2">
      <ul className="flex gap-2" data-testid="handouts">
        {story.handouts.map((h) => (
          <HandoutCard key={h.id} h={h} shown={story.shown} />
        ))}
      </ul>
      {adding ? (
        <form
          className="flex w-56 shrink-0 flex-col gap-1"
          data-testid="handout-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            send('handout-upsert', { caption: caption.trim(), ...(text.trim() ? { text: text.trim() } : {}), ...(assetId ? { assetId } : {}) });
            setCaption('');
            setText('');
            setAssetId(null);
            setAdding(false);
          }}
        >
          <Input value={caption} placeholder="Caption" aria-label="Handout caption" onChange={(e) => setCaption(e.target.value)} />
          <HandoutThumb assetId={assetId ?? undefined} alt="Handout image" />
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={uploading} data-testid="handout-image" onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : assetId ? 'Replace image' : 'Add image'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-testid="handout-image-input"
            onChange={(e) => void pickImage(e.target.files?.[0])}
          />
          <textarea
            value={text}
            placeholder="What the handout says"
            aria-label="Handout text"
            rows={3}
            className="rounded-control border border-line bg-panel px-2 py-1 text-xs text-text"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-1">
            <PrimaryButton type="submit" className="h-6 px-2.5 text-xs" disabled={!ready}>
              Add
            </PrimaryButton>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="shrink-0 self-start" data-testid="handout-add" onClick={() => setAdding(true)}>
          Add handout
        </Button>
      )}
      {story.shown && (
        <Button variant="ghost" size="sm" className="shrink-0 self-start" onClick={() => send('hide', {})}>
          Hide from everyone
        </Button>
      )}
    </div>
  );
}
