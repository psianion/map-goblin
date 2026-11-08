import { useEffect, useState } from 'react';
import { FloatBox, Input, PrimaryButton } from '@dnd/ui';
import { navigate } from '../router';
import { joinAsPlayer, resolveInviteCode } from '../session/auth';
import { prepareTableForJoin } from '../session/prepareTableForJoin';
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

  useEffect(() => {
    if (!linkCode) return;
    let live = true;
    resolveInviteCode(linkCode.toUpperCase()).then(
      () => live && setFound(true),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [linkCode]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const player = await joinAsPlayer(code.trim(), name.trim());
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
