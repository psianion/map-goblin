import { useEffect, useState } from 'react';
import { FloatBox, Input, PrimaryButton, SecondaryButton } from '@dnd/ui';
import { navigate } from '../router';
import { joinAsPlayer, resolveInviteCode } from '../session/auth';
import { prepareTableForJoin } from '../session/prepareTableForJoin';
import { rememberSeat, rememberedSeat, type RememberedSeat } from '../session/seatMemory';
import { useSessionStore } from '../session/store';

/**
 * §2.6: code and name in, a seat at the table out. A code arriving on `/join/:code` is checked
 * on mount and the cursor lands in the name field; the code stays visible so a wrong one is fixable.
 */
export default function JoinSession({ code: linkCode }: { code?: string }) {
  const [code, setCode] = useState((linkCode ?? '').toUpperCase());
  const [name, setName] = useState('');
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** F2: the table this code opens, and the seat this browser last held at it. */
  const [table, setTable] = useState<{ campaignId: string; sessionId: string } | null>(null);
  const [seat, setSeat] = useState<RememberedSeat | null>(null);

  // A code from the link is checked on mount; a typed one once it is whole.
  const checked = (linkCode ?? '').toUpperCase() === code ? code : code.length === 6 ? code : '';
  useEffect(() => {
    if (!checked) return;
    let live = true;
    resolveInviteCode(checked).then(
      (found) => {
        if (!live) return;
        setFound(true);
        setTable(found);
        setSeat(rememberedSeat(found.campaignId));
      },
      (e: unknown) => live && linkCode && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [checked, linkCode]);

  /**
   * Into the table. `again`: the remembered seat. The same session takes the seat back as it
   * was; a new session joins under the remembered name, which the server answers by handing
   * back the token that name held.
   */
  const join = async (again?: RememberedSeat) => {
    setBusy(true);
    setError(null);
    try {
      const sameSeat = again && table && again.sessionId === table.sessionId ? again : null;
      const player = sameSeat
        ? { token: sameSeat.token, identityId: sameSeat.identityId, campaignId: table!.campaignId, sessionId: sameSeat.sessionId }
        : await joinAsPlayer(code.trim(), (again?.name ?? name).trim());
      rememberSeat(player.campaignId, {
        name: (again?.name ?? name).trim(),
        identityId: player.identityId,
        token: player.token,
        sessionId: player.sessionId,
      });
      useSessionStore.getState().connect(player.token);
      setPreparing(true);
      await prepareTableForJoin(player.token);
      navigate('/table');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPreparing(false);
    }
  };

  return (
    <div data-page="join" className="flex h-full items-center justify-center bg-bg p-6 text-text">
      <FloatBox className="w-full max-w-sm p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <header>
            <h1 className="text-xl font-medium">Join a game</h1>
            {found && <p className="mt-1 text-sm text-text-2">Table found. Who are you?</p>}
          </header>
          {seat && (
            <SecondaryButton type="button" disabled={busy} data-testid="join-continue" onClick={() => void join(seat)}>
              Continue as {seat.name}
            </SecondaryButton>
          )}
          <label className="flex flex-col gap-1 text-xs text-text-2" htmlFor="invite-code">
            Invite code
            <Input
              id="invite-code"
              className="font-mono tracking-widest"
              value={code}
              maxLength={6}
              autoFocus={!found}
              autoComplete="off"
              placeholder="ABC234"
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setFound(false);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-2" htmlFor="player-name">
            Your name
            <Input id="player-name" value={name} maxLength={64} autoFocus={found} placeholder="Borin" onChange={(e) => setName(e.target.value)} />
          </label>
          <PrimaryButton type="submit" disabled={busy || code.trim().length === 0 || name.trim().length === 0}>
            {preparing ? 'Preparing map…' : busy ? 'Joining…' : 'Join'}
          </PrimaryButton>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </FloatBox>
    </div>
  );
}
