import { useCallback } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Dialog, DialogPortal, DialogBackdrop, DialogContent, DialogTitle } from '@/ui/dialog';
import { usePublishFlow, type PublishChange } from '@/io/publishFlow';
import { timeAgo } from '../format';
import { useEscapeToClose } from '../useEscapeToClose';

const CHANGED: Record<PublishChange, string> = {
  map: 'Map changed since your last publish.',
  prep: 'Only trigger prep has changed.',
  none: 'No changes since your last publish.',
};

/**
 * Publish the open map to a campaign at the table. Opens on a check of what changed since
 * the last publish; with no stored token for this map it asks for the admin pass, then a
 * campaign (or a new one). Nothing changed still offers Publish anyway: the table may hold
 * another map by now. Enter submits whichever step is showing.
 */
export function PublishDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const flow = usePublishFlow({ open, onClose: close });
  const { mode, busy, busyLabel, error, summary, campaigns, adminPass, newCampaignName } = flow;
  useEscapeToClose(open, close, busy);

  const unchanged = summary?.changed === 'none';
  const submit = () => {
    if (busy) return;
    if (mode === 'summary') void flow.publish(unchanged);
    else if (mode === 'error') flow.retryCheck();
    else if (mode === 'password' && adminPass) void flow.connect();
    else if (mode === 'campaigns' && newCampaignName.trim()) void flow.create();
  };

  const primary =
    mode === 'summary'
      ? unchanged
        ? 'Publish anyway'
        : 'Publish'
      : mode === 'error'
        ? 'Retry'
        : mode === 'password'
          ? 'Continue'
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="v2-backdrop" />
        <DialogContent className="v2-modal max-w-[420px] p-0">
          <div
            data-v2-home=""
            data-testid="v2-publish-dialog"
            onKeyDown={(e) => {
              // Keep the canvas shortcuts out of the fields, and let Enter submit.
              e.stopPropagation();
              if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
              e.preventDefault();
              submit();
            }}
          >
            <div className="v2-modal__head">
              <DialogTitle className="v2-modal__title">Publish to table</DialogTitle>
              <button type="button" className="v2-x" aria-label="Close" onClick={close}>
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>

            {/* A fixed floor that fits the campaigns step with three rows, so the frame stays put
                from step to step; a longer list scrolls inside it. */}
            <div className="v2-modal__body min-h-[289px]">
              {mode === 'checking' && <p className="v2-hint">Checking what changed since your last publish…</p>}

              {mode === 'summary' && summary && (
                <>
                  <div>
                    <span className="v2-label">Campaign</span>
                    <p className="text-[14px]" data-testid="v2-publish-campaign">
                      {summary.campaignLabel}
                    </p>
                    {summary.publishedAt && <p className="v2-hint">Last published {timeAgo(summary.publishedAt)}</p>}
                  </div>
                  <div>
                    <p className="text-[14px]" data-testid="v2-publish-change">
                      {CHANGED[summary.changed]}
                    </p>
                    {/* Only for a map change: prep-only replaces nothing, and Publish anyway
                        may be overwriting a map swapped in at the table. */}
                    {summary.changed === 'map' && (
                      <p className="v2-hint">Light edits made at the table are kept on republish.</p>
                    )}
                  </div>
                </>
              )}

              {mode === 'password' && (
                <div>
                  <label className="v2-label" htmlFor="v2-publish-pass">
                    Admin pass
                  </label>
                  <input
                    id="v2-publish-pass"
                    className="v2-input"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={adminPass}
                    disabled={busy}
                    onChange={(e) => flow.setAdminPass(e.target.value)}
                  />
                  <p className="v2-hint">The pass printed by your table server on first run.</p>
                </div>
              )}

              {mode === 'campaigns' && (
                <>
                  <div>
                    <span className="v2-label">Pick a campaign</span>
                    {campaigns.length === 0 ? (
                      <p className="v2-hint">No campaigns on this server yet.</p>
                    ) : (
                      <div className="flex max-h-[137px] flex-col gap-1.5 overflow-y-auto">
                        {campaigns.map((c, i) => (
                          <button
                            key={c.id}
                            type="button"
                            className="v2-btn w-full justify-start"
                            autoFocus={i === 0}
                            disabled={busy}
                            onClick={() => void flow.pickCampaign(c)}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="v2-label" htmlFor="v2-publish-new-campaign">
                      Create new campaign
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="v2-publish-new-campaign"
                        className="v2-input min-w-0 flex-1"
                        placeholder="Campaign name"
                        autoFocus={campaigns.length === 0}
                        value={newCampaignName}
                        disabled={busy}
                        onChange={(e) => flow.setNewCampaignName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="v2-btn"
                        disabled={busy || !newCampaignName.trim()}
                        onClick={() => void flow.create()}
                      >
                        {busy ? busyLabel || 'Creating…' : 'Create'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {error && (
                <p role="alert" className="v2-error">
                  <AlertCircle size={14} className="mt-px shrink-0" />
                  {error}
                </p>
              )}
            </div>

            <div className="v2-modal__foot">
              <button type="button" className="v2-btn v2-btn--ghost" disabled={busy} onClick={close}>
                {unchanged && mode === 'summary' ? 'Close' : 'Cancel'}
              </button>
              {primary && (
                <button
                  type="button"
                  className="v2-btn v2-btn--primary"
                  data-testid="v2-publish-go"
                  autoFocus={mode !== 'password'}
                  disabled={busy || (mode === 'password' && !adminPass)}
                  onClick={submit}
                >
                  {busy ? busyLabel || 'Publishing…' : primary}
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
