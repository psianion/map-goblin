import { useState } from 'react';
import { Button, Caption, FloatBox, Popover, PopoverContent, PopoverTrigger, PrimaryButton, cn } from '@dnd/ui';
import { Copy, UserPlus } from '@dnd/ui/icons';
import { useSessionStore } from '../../session/store';
import { seatColour } from '../seatColour';
import { inviteLink, useInviteCode, usePlayersJoined } from './inviteCode';
import { withoutSupersededSeats } from './roster';

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="invite-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(link).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
    >
      <Copy aria-hidden strokeWidth={1.75} className="size-3.5" />
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

/** Code, link, QR and the party filling in: the Invite card's body, big or in its popover. */
export function InviteBody({ large }: { large?: boolean }) {
  const code = useInviteCode();
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const party = withoutSupersededSeats(roster).filter((p) => p.role === 'player');
  if (!code) return <p className="text-xs text-text-3">Looking up the invite code…</p>;
  const link = inviteLink(code);
  return (
    <div className="flex gap-4" data-testid="invite-body">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Caption>Invite code</Caption>
        <code data-testid="invite-code" className={cn('font-mono tracking-widest text-text', large ? 'text-4xl' : 'text-2xl')}>
          {code}
        </code>
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs text-text-2" data-testid="invite-link">
            {link}
          </span>
          <CopyLink link={link} />
        </div>
        <Caption className="mt-2">{party.length === 0 ? 'Waiting for players' : 'At the table'}</Caption>
        <ul className="flex flex-col gap-1" data-testid="invite-party">
          {party.length === 0 && <li className="text-xs text-text-3">Players who open the link show up here.</li>}
          {party.map((p) => (
            <li key={p.identityId} className="flex items-center gap-2 text-xs text-text-2">
              <span aria-hidden className="size-2 rounded-pill" style={{ backgroundColor: seatColour(p.identityId) }} />
              {p.name}
              {!p.connected && <span className="text-text-3">away</span>}
            </li>
          ))}
        </ul>
      </div>
      {/* No QR encoder in the repo yet: the box holds the place, the code and link carry the invite. */}
      <div
        data-testid="invite-qr"
        aria-label="QR code"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-control border border-dashed border-line-strong text-center text-xs text-text-3',
          large ? 'size-36' : 'size-24',
        )}
      >
        QR
      </div>
    </div>
  );
}

/** Board 6: the first table's big Invite card, centred over the map until the first player joins. */
export function InviteCard() {
  const role = useSessionStore((s) => s.you?.role);
  const joined = usePlayersJoined();
  const [dismissed, setDismissed] = useState(false);
  if (role !== 'dm' || joined || dismissed) return null;
  return (
    <FloatBox
      className="absolute top-1/2 left-1/2 z-30 flex w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-5"
      data-testid="invite-card"
      data-chrome
      role="dialog"
      aria-label="Invite players"
    >
      <h2 className="text-base font-medium text-text">Invite your players</h2>
      <InviteBody large />
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} data-testid="invite-card-hide">
          Hide
        </Button>
      </div>
    </FloatBox>
  );
}

/** The Invite button in the top-right cluster: prominent until the first join, then quiet. */
export function InviteButton() {
  const role = useSessionStore((s) => s.you?.role);
  const joined = usePlayersJoined();
  if (role !== 'dm') return null;
  const label = (
    <>
      <UserPlus aria-hidden strokeWidth={1.75} className="size-4" />
      Invite
    </>
  );
  return (
    <Popover>
      <PopoverTrigger
        render={
          joined ? (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" data-testid="invite-button">
              {label}
            </Button>
          ) : (
            <PrimaryButton className="h-8 gap-1.5 px-2.5 text-xs" data-testid="invite-button">
              {label}
            </PrimaryButton>
          )
        }
      />
      <PopoverContent align="end" className="w-96 p-4" data-testid="invite-popover">
        <InviteBody />
      </PopoverContent>
    </Popover>
  );
}
