// §2.4.7 — the DM's token library (D12: it lives in module state, not a table). List,
// create/edit, delete, and click-to-place: arming a def here makes the next click on the
// map place it (the pointer handling itself is drag.ts's).

import { useState } from 'react';
import type { Disposition, TokenDef, TokenSize, TokensState } from '@dnd/mechanics/tokens';
import { SIZE_CELLS } from '@dnd/mechanics/tokens';
import { endpoints } from '../../endpoints';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { useTokenInteraction } from './drag';

const SIZES = Object.keys(SIZE_CELLS) as TokenSize[];
const DISPOSITIONS: Disposition[] = ['friendly', 'neutral', 'hostile'];
const NAME_MAX = 60; // matches the server's cap (§2.2) so a rejected upsert is not the way you find out

const blank = { id: null as string | null, name: '', size: 'medium' as TokenSize, disposition: 'neutral' as Disposition, imageAssetId: null as string | null };

/** D11 — same shape as the map upload: raw bytes, bearer token, `{id}` back. */
async function uploadPortrait(file: File): Promise<string> {
  const { token, session } = useSessionStore.getState();
  if (!token || !session) throw new Error('not connected');
  const res = await fetch(`${endpoints.httpBase}/api/campaigns/${encodeURIComponent(session.campaignId)}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.id;
}

export function TokenLibraryPanel() {
  const library = useModuleState<TokensState>('tokens')?.library;
  const placingDefId = useTokenInteraction((s) => s.placingDefId);
  const setPlacing = useTokenInteraction((s) => s.setPlacing);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defs: TokenDef[] = library && typeof library === 'object' ? Object.values(library) : [];
  const send = (action: string, payload: unknown) =>
    useSessionStore.getState().sendCommand('tokens', action, payload);

  const save = () => {
    const name = form.name.trim();
    if (!name) return;
    send('library-upsert', {
      id: form.id ?? undefined,
      name,
      size: form.size,
      disposition: form.disposition,
      imageAssetId: form.imageAssetId,
    });
    setForm(blank);
  };

  const pickPortrait = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      setForm((f) => ({ ...f, imageAssetId: null }));
      const id = await uploadPortrait(file);
      setForm((f) => ({ ...f, imageAssetId: id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      {defs.length === 0 ? (
        <p className="text-neutral-500">No token types yet.</p>
      ) : (
        <ul data-testid="token-library" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {defs.map((def) => (
            <li key={def.id} data-def-id={def.id} className="flex items-center gap-1">
              <button
                type="button"
                data-testid="token-place"
                aria-pressed={placingDefId === def.id}
                onClick={() => setPlacing(placingDefId === def.id ? null : def.id)}
                className={`min-w-0 flex-1 truncate rounded px-2 py-0.5 text-left ${
                  placingDefId === def.id
                    ? 'bg-neutral-700 text-neutral-100'
                    : 'text-neutral-300 hover:bg-neutral-800/60'
                }`}
              >
                {def.name}
              </button>
              <button
                type="button"
                aria-label={`Edit ${def.name}`}
                onClick={() =>
                  setForm({
                    id: def.id,
                    name: def.name,
                    size: def.size,
                    disposition: def.disposition,
                    imageAssetId: def.imageAssetId,
                  })
                }
                className="rounded px-1 text-xs text-neutral-500 hover:text-neutral-200"
              >
                edit
              </button>
              <button
                type="button"
                aria-label={`Delete ${def.name}`}
                onClick={() => send('library-delete', { id: def.id })}
                className="rounded px-1 text-xs text-neutral-600 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {placingDefId && (
        <p data-testid="place-hint" className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300">
          Click the map to place it.
        </p>
      )}

      <form
        data-testid="token-def-form"
        className="flex flex-col gap-1 border-t border-neutral-800 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={NAME_MAX}
          placeholder="Goblin"
          aria-label="Token name"
          data-testid="token-name"
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <div className="flex gap-1">
          <select
            value={form.size}
            onChange={(e) => setForm({ ...form, size: e.target.value as TokenSize })}
            aria-label="Size"
            data-testid="token-size"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-100"
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={form.disposition}
            onChange={(e) => setForm({ ...form, disposition: e.target.value as Disposition })}
            aria-label="Disposition"
            data-testid="token-disposition"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-100"
          >
            {DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <label className="text-xs text-neutral-500">
          {busy ? 'Uploading…' : form.imageAssetId ? 'Portrait ready' : 'Portrait (optional)'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            data-testid="token-portrait"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void pickPortrait(file);
            }}
            className="mt-1 w-full text-xs text-neutral-400 file:mr-2 file:rounded file:border-0 file:bg-neutral-800 file:px-2 file:py-1 file:text-xs file:text-neutral-100 hover:file:bg-neutral-700"
          />
        </label>

        {/* Schema exists server-side; the fields land with S3's fog/vision work. */}
        <details className="text-xs text-neutral-500">
          <summary className="cursor-pointer">Sight &amp; light (S3)</summary>
          <div className="mt-1 flex gap-1">
            <input disabled placeholder="sight range" aria-label="Sight range (S3)" className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900/60 px-1 py-0.5" />
            <input disabled placeholder="light dim/bright" aria-label="Light (S3)" className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900/60 px-1 py-0.5" />
          </div>
        </details>

        <div className="flex gap-1">
          <button
            type="submit"
            disabled={!form.name.trim() || busy}
            data-testid="token-save"
            className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-700 disabled:opacity-40"
          >
            {form.id ? 'Save' : 'Add'}
          </button>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm(blank)}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:text-neutral-200"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded border border-red-900 bg-red-950/60 px-2 py-1 text-xs text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

registerPanel({
  id: 'token-library',
  title: 'Token library',
  roles: ['dm'],
  order: 20,
  component: TokenLibraryPanel,
});
