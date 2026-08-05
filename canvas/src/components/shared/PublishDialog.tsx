import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/store/store';
import { getMapDB } from '@/store/slices/maps';
import type { MapIndexDB, PublishState } from '@/io/mapIndexDB';
import { serializeToBytes } from '@/io/saveLoad';
import {
  hashMapForPublish,
  getPublishToken,
  setPublishToken,
  clearPublishToken,
  listCampaigns,
  createCampaign,
  mintDmToken,
  uploadMap,
  republishScene,
  putScenePrep,
  PublishAuthError,
  type CampaignSummary,
} from '@/io/publish';
import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/toast';

// The factory behind getMapDB() is always canvas's MapIndexDB (see store/init.ts) — the
// core-side MapDB interface just doesn't list the publish-state methods added there.
async function getDb(): Promise<MapIndexDB> {
  return (await getMapDB()) as unknown as MapIndexDB;
}

type Mode = 'checking' | 'summary' | 'password' | 'campaigns';
type Changed = 'map' | 'prep' | 'none';

interface Summary {
  campaignId: string;
  campaignLabel: string;
  sceneId: string;
  changed: Changed;
}

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishDialog({ open, onOpenChange }: PublishDialogProps) {
  const activeMapId = useStore((s) => s.activeMapId);

  const [mode, setMode] = useState<Mode>('checking');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [publishState, setPublishStateLocal] = useState<PublishState | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  // Never persisted — lives only as long as the dialog needs it to mint a token.
  const [adminPass, setAdminPass] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [newCampaignName, setNewCampaignName] = useState('');
  // Names learned this session (from listCampaigns/createCampaign) so the summary step
  // can show one cheaply, without a login round trip just to label an id.
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({});

  const labelFor = useCallback(
    (campaignId: string) => campaignNames[campaignId] ?? campaignId,
    [campaignNames],
  );

  // Reset transient state whenever the dialog is dismissed — the pass must not survive
  // a close, and a stale error/summary must not flash before the next open re-checks.
  useEffect(() => {
    if (open) return;
    setAdminPass('');
    setError(null);
    setNotice(null);
    setMode('checking');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode('checking');
    setError(null);
    setNotice(null);

    (async () => {
      if (!activeMapId) {
        if (!cancelled) setMode('password');
        return;
      }
      const db = await getDb();
      const ps = await db.getPublishState(activeMapId);
      if (cancelled) return;
      setPublishStateLocal(ps);

      const token = ps ? getPublishToken(ps.campaignId) : null;
      if (!ps || !token) {
        setMode('password');
        return;
      }

      const data = useStore.getState().getSerializableState();
      const hash = await hashMapForPublish(data);
      if (cancelled) return;
      const changed: Changed = hash !== ps.mapHash ? 'map' : data.prep ? 'prep' : 'none';
      setSummary({
        campaignId: ps.campaignId,
        campaignLabel: labelFor(ps.campaignId),
        sceneId: ps.sceneId,
        changed,
      });
      setMode('summary');
    })();

    return () => {
      cancelled = true;
    };
    // labelFor intentionally excluded — it would re-run this on every campaignNames update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeMapId]);

  /** Auth failure on any call — the token is dead, so drop it and start over. */
  const handleAuthError = useCallback((campaignId: string) => {
    clearPublishToken(campaignId);
    setMode('password');
    setError('Session expired — reconnect to publish.');
  }, []);

  const runPublish = useCallback(
    async (campaignId: string, token: string, campaignLabel: string) => {
      if (!activeMapId) throw new Error('No active map to publish.');
      const data = useStore.getState().getSerializableState();
      const hash = await hashMapForPublish(data);
      const target = publishState?.campaignId === campaignId ? publishState : null;
      const db = await getDb();
      const mapName = data.mapSettings.name || 'Untitled map';

      if (!target) {
        setBusyLabel('Publishing…');
        const bytes = await serializeToBytes(data);
        const result = await uploadMap(token, campaignId, bytes);
        const next: PublishState = { campaignId, sceneId: result.sceneId, mapHash: hash };
        await db.setPublishState(activeMapId, next);
        setPublishStateLocal(next);
        notify.success(`Published "${mapName}" to ${campaignLabel} — first publish`);
      } else if (hash !== target.mapHash) {
        setBusyLabel('Publishing…');
        const bytes = await serializeToBytes(data);
        await republishScene(token, target.sceneId, bytes);
        const next: PublishState = { ...target, mapHash: hash };
        await db.setPublishState(activeMapId, next);
        setPublishStateLocal(next);
        notify.success(`Republished "${mapName}" to ${campaignLabel} — map updated`);
      } else if (data.prep) {
        setBusyLabel('Updating prep…');
        await putScenePrep(token, target.sceneId, data.prep);
        notify.success(`Updated prep for "${mapName}" in ${campaignLabel}`);
      } else {
        setNotice('No changes since your last publish.');
        return;
      }
      onOpenChange(false);
    },
    [activeMapId, publishState, onOpenChange],
  );

  const handlePublishFromSummary = useCallback(async () => {
    if (!summary) return;
    const token = getPublishToken(summary.campaignId);
    if (!token) {
      setMode('password');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await runPublish(summary.campaignId, token, summary.campaignLabel);
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

  const handleConnectSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
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
        else setError(err instanceof Error ? err.message : 'Could not reach the Good Goblin server.');
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [adminPass],
  );

  const handlePickCampaign = useCallback(
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
        const message = err instanceof Error ? err.message : 'Could not connect.';
        setError(message);
        notify.error(message);
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [adminPass, runPublish],
  );

  const handleCreateCampaign = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = newCampaignName.trim();
      if (!name) return;
      setBusy(true);
      setError(null);
      setBusyLabel('Creating…');
      try {
        const created = await createCampaign(adminPass, name);
        setPublishToken(created.campaignId, created.token);
        setCampaignNames((prev) => ({ ...prev, [created.campaignId]: name }));
        setAdminPass('');
        await runPublish(created.campaignId, created.token, name);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not create campaign.';
        setError(message);
        notify.error(message);
      } finally {
        setBusy(false);
        setBusyLabel('');
      }
    },
    [adminPass, newCampaignName, runPublish],
  );

  const changedLabel: Record<Changed, string> = {
    map: 'Map changed since your last publish.',
    prep: 'Only trigger prep has changed.',
    none: 'No changes since your last publish.',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogContent className="max-w-sm">
          <div className="flex items-center justify-between mb-4">
            <DialogTitle>Publish to Library</DialogTitle>
            <DialogClose className="text-muted-foreground hover:text-foreground transition-colors">
              ✕
            </DialogClose>
          </div>

          <div className="space-y-4">
            {mode === 'checking' && (
              <p className="text-sm text-muted-foreground">Checking publish status…</p>
            )}

            {mode === 'summary' && summary && (
              <>
                <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
                  <div>
                    Campaign: <span className="text-foreground">{summary.campaignLabel}</span>
                  </div>
                  <div>
                    Scene: <span className="font-mono text-foreground">{summary.sceneId}</span>
                  </div>
                  <div>{changedLabel[summary.changed]}</div>
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}
                {notice && <p className="text-xs text-muted-foreground">{notice}</p>}

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" disabled={busy} onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    autoFocus
                    disabled={busy}
                    onClick={handlePublishFromSummary}
                  >
                    {busy ? busyLabel || 'Publishing…' : 'Publish'}
                  </Button>
                </div>
              </>
            )}

            {mode === 'password' && (
              <form onSubmit={handleConnectSubmit} className="space-y-4">
                {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
                <div>
                  <label htmlFor="publish-admin-pass" className="text-xs text-muted-foreground mb-1.5 block">
                    Good Goblin server admin pass
                  </label>
                  <input
                    id="publish-admin-pass"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={adminPass}
                    onChange={(e) => setAdminPass(e.target.value)}
                    className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={busy}
                  />
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1" disabled={busy || !adminPass}>
                    {busy ? busyLabel || 'Connecting…' : 'Continue'}
                  </Button>
                </div>
              </form>
            )}

            {mode === 'campaigns' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Pick a campaign</label>
                  {campaigns.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No campaigns on this server yet.</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {campaigns.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          autoFocus={i === 0}
                          disabled={busy}
                          onClick={() => handlePickCampaign(c)}
                          className="w-full text-left px-2.5 py-1.5 rounded text-sm text-foreground bg-background border border-border hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-border pt-3">
                  <form onSubmit={handleCreateCampaign} className="space-y-2">
                    <label htmlFor="publish-new-campaign" className="text-xs text-muted-foreground block">
                      Or create a new campaign
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="publish-new-campaign"
                        type="text"
                        value={newCampaignName}
                        onChange={(e) => setNewCampaignName(e.target.value)}
                        placeholder="Campaign name"
                        disabled={busy}
                        className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <Button type="submit" disabled={busy || !newCampaignName.trim()}>
                        {busy ? busyLabel || 'Creating…' : 'Create'}
                      </Button>
                    </div>
                  </form>
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

                <div className="pt-1">
                  <Button variant="outline" className="w-full" disabled={busy} onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
