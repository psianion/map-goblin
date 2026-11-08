import { useCallback } from 'react';
import { Button, Dialog, DialogContent, Input, PrimaryButton, SecondaryButton, timeAgo } from '@dnd/ui';
import { usePublishFlow, type PublishChange } from '@/io/publishFlow';
import { useEscapeToClose } from '@/editor/useEscapeToClose';
import { Actions, DialogHead, ErrorLine, Field, Hint } from './parts';

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
  const { mode, busy, busyLabel, error, summary, published, campaigns, adminPass, newCampaignName } = flow;
  useEscapeToClose(open, close, busy);

  const unchanged = summary?.changed === 'none';
  const submit = () => {
    if (busy) return;
    if (mode === 'summary') void flow.publish(unchanged);
    else if (mode === 'published') void flow.openTable();
    else if (mode === 'error') flow.retryCheck();
    else if (mode === 'password' && adminPass) void flow.connect();
    else if (mode === 'campaigns' && newCampaignName.trim()) void flow.create();
  };

  const primary =
    mode === 'summary'
      ? unchanged
        ? 'Publish anyway'
        : 'Publish'
      : mode === 'published'
        ? 'Open the table'
        : mode === 'error'
        ? 'Retry'
        : mode === 'password'
          ? 'Continue'
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
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
        <DialogHead title="Publish to table" onClose={close} />

        {/* A fixed floor that fits the campaigns step with three rows, so the frame stays put
            from step to step; a longer list scrolls inside it. */}
        <div className="flex min-h-[172px] flex-col gap-3 text-[12px] text-text-2">
          {mode === 'checking' && <Hint>Checking what changed since your last publish…</Hint>}

          {mode === 'summary' && summary && (
            <>
              <Field label="Campaign">
                <p className="m-0 text-text" data-testid="v2-publish-campaign">
                  {summary.campaignLabel}
                </p>
                {summary.publishedAt && <Hint>Last published {timeAgo(summary.publishedAt)}</Hint>}
              </Field>
              <div className="flex flex-col gap-1.5">
                <p className="m-0 text-text" data-testid="v2-publish-change">
                  {CHANGED[summary.changed]}
                </p>
                {/* Only for a map change: prep-only replaces nothing, and Publish anyway
                    may be overwriting a map swapped in at the table. */}
                {summary.changed === 'map' && <Hint>Light edits made at the table are kept on republish.</Hint>}
              </div>
            </>
          )}

          {mode === 'published' && published && (
            <Field label="Campaign">
              <p className="m-0 text-text" data-testid="v2-publish-done">
                Published to {published.campaignLabel}.
              </p>
              <Hint>Open the table to run it; you are signed in there as the DM.</Hint>
            </Field>
          )}

          {mode === 'password' && (
            <Field label="Admin pass" htmlFor="v2-publish-pass">
              <Input
                id="v2-publish-pass"
                type="password"
                autoComplete="off"
                autoFocus
                value={adminPass}
                disabled={busy}
                onChange={(e) => flow.setAdminPass(e.target.value)}
              />
              <Hint>The pass printed by your table server on first run.</Hint>
            </Field>
          )}

          {mode === 'campaigns' && (
            <>
              <Field label="Pick a campaign">
                {campaigns.length === 0 ? (
                  <Hint>No campaigns on this server yet.</Hint>
                ) : (
                  <div className="flex max-h-[96px] flex-col gap-1.5 overflow-y-auto">
                    {campaigns.map((c, i) => (
                      <SecondaryButton
                        key={c.id}
                        className="w-full justify-start"
                        autoFocus={i === 0}
                        disabled={busy}
                        onClick={() => void flow.pickCampaign(c)}
                      >
                        {c.name}
                      </SecondaryButton>
                    ))}
                  </div>
                )}
              </Field>
              <Field label="Create new campaign" htmlFor="v2-publish-new-campaign">
                <div className="flex gap-1.5">
                  <Input
                    id="v2-publish-new-campaign"
                    className="min-w-0 flex-1"
                    placeholder="Campaign name"
                    autoFocus={campaigns.length === 0}
                    value={newCampaignName}
                    disabled={busy}
                    onChange={(e) => flow.setNewCampaignName(e.target.value)}
                  />
                  <SecondaryButton disabled={busy || !newCampaignName.trim()} onClick={() => void flow.create()}>
                    {busy ? busyLabel || 'Creating…' : 'Create'}
                  </SecondaryButton>
                </div>
              </Field>
            </>
          )}

          {error && <ErrorLine>{error}</ErrorLine>}
        </div>

        <Actions>
          <Button variant="outline" disabled={busy} onClick={close}>
            {(unchanged && mode === 'summary') || mode === 'published' ? 'Close' : 'Cancel'}
          </Button>
          {primary && (
            <PrimaryButton
              data-testid={mode === 'published' ? 'v2-publish-open-table' : 'v2-publish-go'}
              autoFocus={mode !== 'password'}
              disabled={busy || (mode === 'password' && !adminPass)}
              onClick={submit}
            >
              {busy ? busyLabel || 'Publishing…' : primary}
            </PrimaryButton>
          )}
        </Actions>
      </DialogContent>
    </Dialog>
  );
}
