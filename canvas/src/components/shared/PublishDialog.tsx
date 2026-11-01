import { usePublishFlow, type PublishChange } from '@/io/publishFlow';
import {
  Dialog,
  DialogPortal,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { timeAgo } from '@/v2/format';

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishDialog({ open, onOpenChange }: PublishDialogProps) {
  const {
    mode,
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
  } = usePublishFlow({ open, onClose: () => onOpenChange(false) });

  // Nothing changed is no reason to refuse: the table may hold another map by now.
  const handlePublishFromSummary = () => void publish(summary?.changed === 'none');
  const handlePickCampaign = (c: (typeof campaigns)[number]) => void pickCampaign(c);
  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void connect();
  };
  const handleCreateCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    void create();
  };

  const changedLabel: Record<PublishChange, string> = {
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
            <DialogTitle>Publish to table</DialogTitle>
            <DialogClose className="text-muted-foreground hover:text-foreground transition-colors">
              ✕
            </DialogClose>
          </div>

          <div className="space-y-4">
            {mode === 'checking' && (
              <>
                <p className="text-sm text-muted-foreground">Checking publish status…</p>
                <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </>
            )}

            {mode === 'error' && (
              <>
                <p className="text-xs text-destructive">{error}</p>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1" autoFocus onClick={retryCheck}>
                    Retry
                  </Button>
                </div>
              </>
            )}

            {mode === 'summary' && summary && (
              <>
                <div className="rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
                  <div>
                    Campaign: <span className="text-foreground">{summary.campaignLabel}</span>
                  </div>
                  {summary.publishedAt && <div>Last published {timeAgo(summary.publishedAt)}</div>}
                  <div>{changedLabel[summary.changed]}</div>
                  {summary.changed === 'map' && <div>Light edits made at the table are kept on republish.</div>}
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}

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
                <div>
                  <label htmlFor="publish-admin-pass" className="text-xs text-muted-foreground mb-1.5 block">
                    Admin pass
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
                  <p className="text-xs text-muted-foreground mt-1.5">The pass printed by your table server on first run.</p>
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
