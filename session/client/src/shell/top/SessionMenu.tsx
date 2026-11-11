import { useState } from 'react';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { Button, Caption, Popover, PopoverContent, PopoverTrigger, Separator, SwitchRow, formatBytes } from '@dnd/ui';
import { Users } from '@dnd/ui/icons';
import { endSession } from '../../session/auth';
import { useModuleState, useSessionStore } from '../../session/store';
import { librarySize, runLibrary, useTableAssets } from '../../renderer/assetLoading';
import { seatColour } from '../seatColour';
import { useInviteCode } from './inviteCode';
import { withoutSupersededSeats } from './roster';
import { assignToken, exportCampaign, leaveTable, setTableSwitch, type TableSwitches } from './sessionActions';

const selectClass = 'h-7 max-w-36 rounded-control border border-line bg-panel px-1.5 text-xs text-text';

function sceneTokens(state: TokensState | undefined, sceneId: string | null): Token[] {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  return scene ? Object.values(scene).filter((t): t is Token => !!t && typeof t.id === 'string') : [];
}

/** Who is here; the DM assigns each player a token on the live scene from their row. */
function Roster({ dm }: { dm: boolean }) {
  const roster = useSessionStore((s) => s.session?.players ?? []);
  const youId = useSessionStore((s) => s.you?.identityId);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const tokens = sceneTokens(useModuleState<TokensState>('tokens'), sceneId);
  const people = withoutSupersededSeats(roster);
  return (
    <ul className="flex flex-col gap-1" data-testid="session-roster">
      {people.map((p) => {
        const owned = tokens.find((t) => t.ownerId === p.identityId);
        return (
          <li key={p.identityId} className="flex h-8 items-center gap-2 text-xs text-text-2" data-connected={p.connected}>
            <span
              aria-hidden
              className={p.connected ? 'size-2 shrink-0 rounded-pill' : 'size-2 shrink-0 rounded-pill opacity-40'}
              style={{ backgroundColor: seatColour(p.identityId) }}
            />
            <span className="min-w-0 truncate text-text">{p.name}</span>
            {p.identityId === youId && <span className="text-text-3">(you)</span>}
            {!p.connected && <span className="text-text-3">away</span>}
            {p.role === 'dm' && <span className="ml-auto rounded-key border border-line px-1.5 text-text-3">DM</span>}
            {dm && p.role === 'player' && (
              <select
                aria-label={`Token for ${p.name}`}
                data-testid={`assign-${p.identityId}`}
                className={`ml-auto ${selectClass}`}
                value={owned?.id ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next) assignToken(next, p.identityId);
                  else if (owned) assignToken(owned.id, null);
                }}
              >
                <option value="">No token</option>
                {tokens.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || 'Unnamed'}
                  </option>
                ))}
              </select>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EndSession() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return (
      <Button variant="destructive" size="sm" data-testid="end-session" onClick={() => setConfirming(true)}>
        End session
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="destructive"
        size="sm"
        data-testid="end-session-confirm"
        disabled={busy}
        onClick={async () => {
          const { session, token } = useSessionStore.getState();
          if (!session || !token) return;
          setBusy(true);
          setError(null);
          try {
            await endSession(session.sessionId, token);
          } catch (e) {
            setBusy(false);
            setConfirming(false);
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        End for everyone?
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="basis-full text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The DM's own download of every set, for running scenes later without waiting. Players never get it. */
function LibraryDownload() {
  const status = useTableAssets((s) => s.library.status);
  // Read on render: the manifests are in once the boot is, and the menu opens long after.
  const size = librarySize();
  const label =
    status === 'running' || status === 'paused'
      ? 'Downloading the library…'
      : status === 'done'
        ? 'Library downloaded'
        : `Download the full library${size > 0 ? ` · ${formatBytes(size)}` : ''}`;
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      data-testid="library-download"
      disabled={status !== 'idle' && status !== 'failed'}
      onClick={() => void runLibrary()}
    >
      {label}
    </Button>
  );
}

/** The DM's half: invite code, the table switches, export, the library, End session. */
function DmControls() {
  const code = useInviteCode();
  const table = useModuleState<TableSwitches>('table');
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  return (
    <>
      {code && (
        <div className="flex items-center gap-2 text-xs text-text-2">
          Invite code
          <code className="ml-auto font-mono text-sm tracking-widest text-text" data-testid="session-invite-code">
            {code}
          </code>
        </div>
      )}
      <Separator />
      <SwitchRow
        label="Pause the table"
        className="w-full"
        checked={!!table?.paused}
        disabled={!table}
        onCheckedChange={(on) => setTableSwitch('pause', on)}
      />
      <SwitchRow
        label="Lock token movement"
        className="w-full"
        checked={!!table?.movementLocked}
        disabled={!table}
        onCheckedChange={(on) => setTableSwitch('lock-movement', on)}
      />
      <Separator />
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          data-testid="export-campaign"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            setExportNote(await exportCampaign());
            setExporting(false);
          }}
        >
          Export campaign
        </Button>
        <p className="text-xs text-text-3">
          {exportNote ?? 'Maps, state and art in one zip. Importing an archive is not supported yet.'}
        </p>
      </div>
      <LibraryDownload />
      <EndSession />
    </>
  );
}

/** Top right: the Session menu. The DM runs the table from it; a player can leave. */
export function SessionMenu() {
  const role = useSessionStore((s) => s.you?.role);
  if (!role) return null;
  const dm = role === 'dm';
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" data-testid="session-menu">
            <Users aria-hidden strokeWidth={1.75} className="size-4" />
            Session
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-80 flex-col gap-3 p-3" data-testid="session-popover">
        <Caption>At the table</Caption>
        <Roster dm={dm} />
        {dm ? (
          <DmControls />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            data-testid="leave-table"
            onClick={leaveTable}
          >
            Leave table
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
