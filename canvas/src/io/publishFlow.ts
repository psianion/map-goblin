import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/store/store';
import { getMapDB } from '@/store/slices/maps';
import type { MapIndexDB, PublishRecord, PublishState } from '@/io/mapIndexDB';
import { serializeToBytes } from '@/io/saveLoad';
import { getTerrainRenderer } from '@dnd/core/src/engine/terrain/TerrainRenderer';
import { withoutTraceLayers } from '@dnd/core/src/shared/traceLayer';
import {
  hashMapForPublish,
  hashPrep,
  getPublishToken,
  setPublishToken,
  clearPublishToken,
  listCampaigns,
  createCampaign,
  mintDmToken,
  mintHandoff,
  uploadMap,
  republishScene,
  putScenePrep,
  PublishAuthError,
  PublishGoneError,
  type CampaignSummary,
} from '@/io/publish';
import { notify } from '@dnd/ui/toast';

// The factory behind getMapDB() is always canvas's MapIndexDB (see store/init.ts) — the
// core-side MapDB interface just doesn't list the publish-state methods added there.
async function getDb(): Promise<MapIndexDB> {
  return (await getMapDB()) as unknown as MapIndexDB;
}

export type PublishMode = 'checking' | 'summary' | 'error' | 'password' | 'campaigns' | 'published';
export type PublishChange = 'map' | 'prep' | 'none';

export interface PublishSummary {
  campaignId: string;
  campaignLabel: string;
  publishedAt?: number;
  changed: PublishChange;
}

/**
 * What a publish to one campaign sends: the whole map the first time, the whole map again
 * when it changed (or when forced), only the prep when that alone changed, else nothing.
 */
export function decidePublish(
  target: PublishState | null,
  hash: string,
  prepHash: string,
  force: boolean,
): 'upload' | 'republish' | 'prep' | 'none' {
  if (!target) return 'upload';
  if (force || hash !== target.mapHash) return 'republish';
  if (prepHash !== target.prepHash) return 'prep';
  return 'none';
}

/** The map as it would be published now (never its trace layers), with its two hashes. */
export async function currentHashes() {
  const data = withoutTraceLayers(useStore.getState().getSerializableState());
  // Match serializeToBytes: a stroke still sitting in the terrain worker's buffer
  // must land in the store before pngs is read, or it silently misses the hash.
  await getTerrainRenderer()?.flushPersistNow();
  const pngs = useStore.getState().terrainSplats.pngs;
  const [hash, prepHash] = await Promise.all([hashMapForPublish(data, pngs), hashPrep(data.prep)]);
  return { data, hash, prepHash };
}

/**
 * The publish dialog's state machine: check what changed
 * since the last publish, connect with the admin pass, pick or create a campaign, publish.
 */
export function usePublishFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const activeMapId = useStore((s) => s.activeMapId);
  const switching = useStore((s) => s.isMapSwitching);

  const [mode, setMode] = useState<PublishMode>('checking');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [publishState, setPublishStateLocal] = useState<PublishRecord | null>(null);
  const [summary, setSummary] = useState<PublishSummary | null>(null);
  // Where the last publish went, for the done step's Open the table.
  const [published, setPublished] = useState<{ campaignId: string; campaignLabel: string } | null>(null);

  // Never persisted — lives only as long as the dialog needs it to mint a token.
  const [adminPass, setAdminPass] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [newCampaignName, setNewCampaignName] = useState('');
  // Names learned this session (from listCampaigns/createCampaign) so the summary step
  // can show one cheaply, without a login round trip just to label an id.
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({});
  // Bumped by Retry, to run the open check again.
  const [checkRun, setCheckRun] = useState(0);

  // A name learned this session, else the one stored with the publish; the id only for a
  // record from before names were kept.
  const labelFor = useCallback(
    (campaignId: string, stored?: string) => campaignNames[campaignId] ?? stored ?? campaignId,
    [campaignNames],
  );

  // Reset transient state whenever the dialog is dismissed — the pass must not survive
  // a close, and a stale error/summary must not flash before the next open re-checks.
  useEffect(() => {
    if (open) return;
    setAdminPass('');
    setError(null);
    setPublished(null);
    setMode('checking');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode('checking');
    setError(null);

    (async () => {
      // No map yet, or one still loading: stay on Checking. This runs again once it is in.
      if (!activeMapId || switching) return;
      const db = await getDb();
      const record = await db.getPublishState(activeMapId);
      if (cancelled) return;
      setPublishStateLocal(record);

      // A map may have been published to more than one campaign — pick whichever
      // slot still has a live token; the rest surface once that one's re-published
      // or the user connects fresh via the campaign picker.
      const entry = record
        ? Object.entries(record).find(([campaignId]) => getPublishToken(campaignId))
        : undefined;
      if (!entry) {
        setMode('password');
        return;
      }
      const [campaignId, ps] = entry;

      const { hash, prepHash } = await currentHashes();
      if (cancelled) return;
      const changed: PublishChange = hash !== ps.mapHash ? 'map' : prepHash !== ps.prepHash ? 'prep' : 'none';
      setSummary({
        campaignId,
        campaignLabel: labelFor(campaignId, ps.campaignName),
        publishedAt: ps.publishedAt,
        changed,
      });
      setMode('summary');
    })().catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error && err.message ? err.message : 'Could not check what changed.');
      setMode('error');
    });

    return () => {
      cancelled = true;
    };
    // labelFor intentionally excluded — it would re-run this on every campaignNames update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeMapId, switching, checkRun]);

  const retryCheck = useCallback(() => setCheckRun((n) => n + 1), []);

  /** Auth failure on any call — the token is dead, so drop it and start over. */
  const handleAuthError = useCallback((campaignId: string) => {
    clearPublishToken(campaignId);
    setMode('password');
    setError('Session expired — reconnect to publish.');
  }, []);

  const runPublish = useCallback(
    async (campaignId: string, token: string, campaignLabel: string, force = false) => {
      if (!activeMapId) throw new Error('No active map to publish.');
      const { data, hash, prepHash } = await currentHashes();
      const target = publishState?.[campaignId] ?? null;
      const db = await getDb();
      const mapName = data.mapSettings.name || 'Untitled map';

      const remember = async (published: PublishState) => {
        const next: PublishState = {
          ...published,
          campaignName: campaignLabel === campaignId ? published.campaignName : campaignLabel,
          publishedAt: Date.now(),
        };
        await db.setPublishState(activeMapId, campaignId, next);
        setPublishStateLocal((prev) => ({ ...prev, [campaignId]: next }));
      };

      const upload = async () => {
        setBusyLabel('Publishing…');
        const bytes = await serializeToBytes(data);
        const result = await uploadMap(token, campaignId, bytes);
        await remember({ sceneId: result.sceneId, mapHash: hash, prepHash });
      };

      const action = decidePublish(target, hash, prepHash, force);
      if (target && action === 'none') {
        // Nothing changed: say so, and offer Publish anyway (the table may hold another
        // map by now, after a Replace map there).
        setSummary({ campaignId, campaignLabel, publishedAt: target.publishedAt, changed: 'none' });
        setMode('summary');
        return;
      }
      try {
        if (!target) {
          await upload();
          notify.success(`Published "${mapName}" to ${campaignLabel} — first publish`);
        } else if (action === 'republish') {
          setBusyLabel('Publishing…');
          const bytes = await serializeToBytes(data);
          await republishScene(token, target.sceneId, bytes);
          await remember({ ...target, mapHash: hash, prepHash });
          notify.success(`Republished "${mapName}" to ${campaignLabel} — map updated`);
        } else {
          setBusyLabel('Updating prep…');
          await putScenePrep(token, target.sceneId, data.prep ?? { version: 3, triggers: [], notes: [], rooms: [] });
          await remember({ ...target, prepHash });
          notify.success(`Updated prep for "${mapName}" in ${campaignLabel}`);
        }
      } catch (err) {
        if (!(err instanceof PublishGoneError)) throw err;
        // The scene was deleted at the table: forget it and publish as a new one, same click.
        await db.clearPublishState(activeMapId, campaignId);
        setPublishStateLocal((prev) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [campaignId]: _gone, ...rest } = prev ?? {};
          return rest;
        });
        await upload();
        notify.success(
          `Published "${mapName}" to ${campaignLabel} as a new scene — the old one was removed at the table`,
        );
      }
      // The dialog stays open on a done step, so the DM can go straight to the table.
      setPublished({ campaignId, campaignLabel });
      setMode('published');
    },
    [activeMapId, publishState],
  );

  /** Publish from the summary; `force` republishes the map even when nothing changed. */
  const publish = useCallback(async (force = false) => {
    if (!summary) return;
    const token = getPublishToken(summary.campaignId);
    if (!token) {
      setMode('password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runPublish(summary.campaignId, token, summary.campaignLabel, force);
    } catch (err) {
      if (err instanceof PublishAuthError) {
        handleAuthError(summary.campaignId);
      } else {
        const message = err instanceof Error ? err.message : 'Publish failed.';
        setError(message);
        notify.error(message);
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }, [summary, runPublish, handleAuthError]);

  const connect = useCallback(async () => {
    setBusy(true);
    setBusyLabel('Connecting…');
    setError(null);
    try {
      const { campaigns: list } = await listCampaigns(adminPass);
      setCampaigns(list);
      setCampaignNames((prev) => {
        const next = { ...prev };
        for (const c of list) next[c.id] = c.name;
        return next;
      });
      setMode('campaigns');
    } catch (err) {
      if (err instanceof PublishAuthError) setError('Invalid admin pass.');
      else setError(err instanceof Error ? err.message : 'Could not reach the table server.');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }, [adminPass]);

  const pickCampaign = useCallback(
    async (campaign: CampaignSummary) => {
      setBusy(true);
      setError(null);
      setBusyLabel('Connecting…');
      try {
        const { token } = await mintDmToken(adminPass, campaign.id);
        setPublishToken(campaign.id, token);
        setAdminPass('');
        await runPublish(campaign.id, token, campaign.name);
      } catch (err) {
        if (err instanceof PublishAuthError) {
          handleAuthError(campaign.id);
        } else {
          const message = err instanceof Error ? err.message : 'Could not connect.';
          setError(message);
          notify.error(message);
        }
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [adminPass, runPublish, handleAuthError],
  );

  const create = useCallback(async () => {
    const name = newCampaignName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setBusyLabel('Creating…');
    // Only set once createCampaign resolves — a 401 on that call itself has no
    // campaign to drop a token for, so it's reported as an invalid admin pass instead.
    let campaignId: string | undefined;
    try {
      const created = await createCampaign(adminPass, name);
      campaignId = created.campaignId;
      setPublishToken(created.campaignId, created.token);
      setCampaignNames((prev) => ({ ...prev, [created.campaignId]: name }));
      setAdminPass('');
      await runPublish(created.campaignId, created.token, name);
    } catch (err) {
      if (err instanceof PublishAuthError && campaignId) {
        handleAuthError(campaignId);
      } else if (err instanceof PublishAuthError) {
        setError('Invalid admin pass.');
      } else {
        const message = err instanceof Error ? err.message : 'Could not create campaign.';
        setError(message);
        notify.error(message);
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }, [adminPass, newCampaignName, runPublish, handleAuthError]);

  /**
   * Open the table in a new tab, signed in as this campaign's DM: the server mints a
   * single-use code and names the table link that carries it. The tab is opened before the
   * request so the browser counts it as the click's, not as a popup.
   */
  const openTable = useCallback(async () => {
    if (!published) return;
    const token = getPublishToken(published.campaignId);
    if (!token) {
      handleAuthError(published.campaignId);
      return;
    }
    const tab = window.open('', '_blank');
    setBusy(true);
    setBusyLabel('Opening…');
    setError(null);
    try {
      const { tableUrl } = await mintHandoff(token, published.campaignId);
      if (tab) {
        tab.opener = null;
        tab.location.href = tableUrl;
      } else {
        window.open(tableUrl, '_blank', 'noopener');
      }
      onClose();
    } catch (err) {
      tab?.close();
      if (err instanceof PublishAuthError) handleAuthError(published.campaignId);
      else setError(err instanceof Error ? err.message : 'Could not open the table.');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }, [published, handleAuthError, onClose]);

  return {
    mode,
    published,
    openTable,
    busy,
    busyLabel,
    error,
    summary,
    campaigns,
    adminPass,
    setAdminPass,
    newCampaignName,
    setNewCampaignName,
    publish,
    connect,
    pickCampaign,
    create,
    retryCheck,
  };
}
