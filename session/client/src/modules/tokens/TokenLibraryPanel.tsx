// §2.4.7 — the DM's token library (D12: it lives in module state, not a table). List,
// create/edit, delete, and click-to-place: arming a def here makes the next click on the
// map place it (the pointer handling itself is drag.ts's).
//
// M3: folded into the Tokens popover as its "Library" tab (TokenPanel.tsx owns the tab
// chrome and the footer); this file no longer registers its own panel.

import { useEffect, useMemo, useState } from 'react';
import type { Disposition, TokenDef, TokenSize, TokensState } from '@dnd/mechanics/tokens';
import { SIZE_CELLS } from '@dnd/mechanics/tokens';
import { endpoints } from '../../endpoints';
import { useModuleState, useSessionStore } from '../../session/store';
import { useTokenInteraction } from './drag';
import {
  DEFAULT_LIGHT,
  DEFAULT_SIGHT,
  VISION_MODES,
  mapScale,
  toCells,
  toUnits,
  type Light,
  type Sight,
} from './sight';
import {
  DOT_CLASS,
  LIBRARY_FILTER_AT,
  LIBRARY_ROW_CAP,
  armedButtonClass,
  buttonClass,
  filterInputClass,
  ghostButtonClass,
  numberFieldClass,
  selectFieldClass,
  useTokenLibraryUi,
} from './tokensUi';

const SIZES = Object.keys(SIZE_CELLS) as TokenSize[];
const DISPOSITIONS: Disposition[] = ['friendly', 'neutral', 'hostile'];
const NAME_MAX = 60; // matches the server's cap (§2.2) so a rejected upsert is not the way you find out

const blank = {
  id: null as string | null,
  name: '',
  size: 'medium' as TokenSize,
  disposition: 'neutral' as Disposition,
  imageAssetId: null as string | null,
  // P4 §3 — the def's own sight and light, which `place` copies onto every instance (D12).
  sight: null as Sight | null,
  light: null as Light | null,
};

// The select vocabulary local to this form (size, disposition, vision mode) — distinct
// visual weight from `numberFieldClass`'s narrow numeric fields, so it stays its own atom
// rather than forcing a merge with a shape it doesn't share.
const selectClass =
  'min-w-0 flex-1 rounded border border-border-default bg-surface-1 px-1 py-1 text-xs text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

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

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

export function TokenLibraryPanel() {
  const library = useModuleState<TokensState>('tokens')?.library;
  const placingDefId = useTokenInteraction((s) => s.placingDefId);
  const setPlacing = useTokenInteraction((s) => s.setPlacing);
  const mapData = useSessionStore((s) => s.mapData);
  const filter = useTokenLibraryUi((s) => s.filter);
  const setFilter = useTokenLibraryUi((s) => s.setFilter);
  const editingId = useTokenLibraryUi((s) => s.editingId);
  const closeForm = useTokenLibraryUi((s) => s.close);
  const openEdit = useTokenLibraryUi((s) => s.openEdit);
  // The unit the DM is reading off the table's own map — the same one TokenPanel quotes, so
  // the two panels they alternate between never disagree about what "30" means.
  const scale = useMemo(() => mapScale(mapData), [mapData]);

  const defs: TokenDef[] = library && typeof library === 'object' ? Object.values(library) : [];
  const editingDef = editingId && editingId !== 'new' ? (defs.find((d) => d.id === editingId) ?? null) : null;
  const formOpen = editingId !== null;

  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The draft follows whichever def is being edited (or starts blank for "new") — switching
  // targets resets it rather than carrying the previous def's fields into this one.
  useEffect(() => {
    if (editingId === 'new') setForm(blank);
    else if (editingDef) {
      setForm({
        id: editingDef.id,
        name: editingDef.name,
        size: editingDef.size,
        disposition: editingDef.disposition,
        imageAssetId: editingDef.imageAssetId,
        sight: editingDef.sight,
        light: editingDef.light,
      });
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const save = () => {
    const name = form.name.trim();
    if (!name) return;
    send('library-upsert', {
      id: form.id ?? undefined,
      name,
      size: form.size,
      disposition: form.disposition,
      imageAssetId: form.imageAssetId,
      sight: form.sight,
      light: form.light,
    });
    closeForm();
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

  const showFilter = !formOpen && defs.length >= LIBRARY_FILTER_AT;
  const needle = filter.trim().toLowerCase();
  const filtered = needle ? defs.filter((d) => d.name.toLowerCase().includes(needle)) : defs;
  // The form is the other thing this ledger has to fit: editing collapses the list to the
  // one row in play (or to nothing, for a def that does not exist yet), the way M3's ledger
  // calls for, so an open form never has to fight a 16-row list for the same height budget.
  const listRows = formOpen ? (editingDef ? [editingDef] : []) : filtered.slice(0, LIBRARY_ROW_CAP);
  const hiddenCount = formOpen ? 0 : filtered.length - listRows.length;
  const placingDef = placingDefId ? defs.find((d) => d.id === placingDefId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
      {showFilter && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter library"
          aria-label="Filter library"
          data-testid="token-library-filter"
          className={filterInputClass}
        />
      )}

      {defs.length === 0 && !formOpen ? (
        <p className="text-text-muted">No token types yet.</p>
      ) : (
        <>
          <ul data-testid="token-library" className="flex flex-col">
            {listRows.map((def) => (
              <li key={def.id} className="flex h-8 items-center gap-2 rounded px-2">
                <i className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[def.disposition] ?? DOT_CLASS.neutral}`} />
                <span className="min-w-0 flex-1 truncate">{def.name}</span>
                <button
                  type="button"
                  aria-label={`Place ${def.name}`}
                  data-testid="token-place"
                  aria-pressed={placingDefId === def.id}
                  onClick={() => setPlacing(placingDefId === def.id ? null : def.id)}
                  className={placingDefId === def.id ? armedButtonClass : buttonClass}
                >
                  {placingDefId === def.id ? 'Placing' : 'Place'}
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${def.name}`}
                  data-testid="token-edit"
                  onClick={() => openEdit(def.id)}
                  className={ghostButtonClass}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && <p className="text-[11px] text-text-muted">+{hiddenCount} more</p>}
        </>
      )}

      {placingDef && !formOpen && (
        <p data-testid="place-hint" className="rounded bg-surface-3 px-2 py-1 text-xs text-text-secondary">
          Click the map to place {placingDef.name}. Esc stops.
        </p>
      )}

      {formOpen && (
        <form
          data-testid="token-def-form"
          className="flex flex-col gap-1 border-t border-border-default pt-2"
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
            className="rounded border border-border-default bg-surface-1 px-2 py-1 text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
          <div className="flex gap-1">
            <select
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value as TokenSize })}
              aria-label="Size"
              data-testid="token-size"
              className={selectClass}
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
              className={selectClass}
            >
              {DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <label className="text-xs text-text-muted">
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
              className="mt-1 w-full text-xs text-text-secondary file:mr-2 file:rounded file:border-0 file:bg-surface-3 file:px-2 file:py-1 file:text-xs file:text-text-primary hover:file:bg-surface-2"
            />
          </label>

          {/* P4 §3 — live, and folded away: most defs are a name and a portrait, and a DM
              authoring a torchbearer opens this once. Ranges are in the map's own unit; the def
              stores cells, the way the sweep and the light pool measure. */}
          <details data-testid="token-def-sight" className="text-xs text-text-muted">
            <summary className="cursor-pointer">Sight &amp; light</summary>
            <div className="mt-1 flex flex-col gap-1">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  data-testid="token-def-has-sight"
                  checked={form.sight !== null}
                  onChange={(e) => setForm({ ...form, sight: e.target.checked ? DEFAULT_SIGHT : null })}
                />
                Vision
              </label>
              {form.sight && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step={scale.value}
                    aria-label="Sight range"
                    data-testid="token-def-sight-range"
                    value={toUnits(form.sight.range, scale)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sight: {
                          ...(form.sight as Sight),
                          range: Math.max(0, toCells(e.target.valueAsNumber || 0, scale)),
                        },
                      })
                    }
                    className={numberFieldClass}
                  />
                  <span className="shrink-0">{scale.unit}</span>
                  <select
                    aria-label="Vision mode"
                    data-testid="token-def-vision-mode"
                    value={form.sight.visionMode}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sight: { ...(form.sight as Sight), visionMode: e.target.value as Sight['visionMode'] },
                      })
                    }
                    className={selectFieldClass}
                  >
                    {VISION_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  data-testid="token-def-has-light"
                  checked={form.light !== null}
                  onChange={(e) => setForm({ ...form, light: e.target.checked ? DEFAULT_LIGHT : null })}
                />
                Carried light
              </label>
              {form.light && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step={scale.value}
                    aria-label="Bright light radius"
                    data-testid="token-def-light-bright"
                    value={toUnits(form.light.bright, scale)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        light: {
                          ...(form.light as Light),
                          bright: Math.max(0, toCells(e.target.valueAsNumber || 0, scale)),
                        },
                      })
                    }
                    className={numberFieldClass}
                  />
                  <span className="shrink-0">bright</span>
                  <input
                    type="number"
                    min={0}
                    step={scale.value}
                    aria-label="Dim light radius"
                    data-testid="token-def-light-dim"
                    value={toUnits(form.light.dim, scale)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        light: {
                          ...(form.light as Light),
                          dim: Math.max(0, toCells(e.target.valueAsNumber || 0, scale)),
                        },
                      })
                    }
                    className={numberFieldClass}
                  />
                  <span className="shrink-0">dim</span>
                  <input
                    type="color"
                    aria-label="Light colour"
                    data-testid="token-def-light-color"
                    value={form.light.color}
                    onChange={(e) =>
                      setForm({ ...form, light: { ...(form.light as Light), color: e.target.value } })
                    }
                    className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border-default bg-surface-1"
                  />
                </div>
              )}
            </div>
          </details>

          <div className="flex gap-1">
            <button
              type="submit"
              disabled={!form.name.trim() || busy}
              data-testid="token-save"
              className={buttonClass}
            >
              {form.id ? 'Save' : 'Add'}
            </button>
            <button type="button" data-testid="token-cancel" onClick={closeForm} className={ghostButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
