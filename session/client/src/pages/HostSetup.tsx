import { useState } from 'react';
import { endpoints } from '../endpoints';
import { navigate } from '../router';
import { createCampaignAsDm, startSession, uploadMapFile, type DmSession } from '../session/auth';
import { useSessionStore } from '../session/store';

const STEPS = ['Server', 'Campaign', 'Map', 'Invite'];

const field =
  'w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500';
const primary =
  'rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40';

/**
 * §2.6 — the DM's four steps: server → campaign → map → invite code.
 *
 * D4: a browser tab cannot spawn a server, so step 1 hands over the command to run
 * instead of pretending to "Quick Host".
 *
 * ponytail: forward-only. Every step but the first mints or uploads something on the
 * server, so a Back button would need undo routes that do not exist — reload and start
 * over. Add one when the server grows a DELETE for campaigns.
 */
export default function HostSetup() {
  const [step, setStep] = useState(1);
  const [serverUrl, setServerUrl] = useState(endpoints.httpBase);
  const [adminPass, setAdminPass] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [dm, setDm] = useState<DmSession | null>(null);
  const [map, setMap] = useState<{ name: string; sizeBytes: number } | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every network step is the same three lines around the call that differs. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createCampaign = () =>
    run(async () => {
      setDm(await createCampaignAsDm(serverUrl, adminPass, campaignName || 'Untitled campaign'));
      setStep(3);
    });

  const uploadMap = (file: File) =>
    run(async () => {
      if (!dm) return;
      setMap(await uploadMapFile(dm.campaignId, dm.token, await file.text()));
    });

  const openTable = () =>
    run(async () => {
      if (!dm) return;
      const opened = await startSession(dm.campaignId, dm.token);
      setInviteCode(opened.inviteCode);
    });

  const enterTable = () => {
    if (!dm || !inviteCode) return;
    const store = useSessionStore.getState();
    store.setInviteCode(inviteCode); // GameTable's InviteCodeChip reads it from here
    store.connect(dm.token);
    navigate('/table');
  };

  const joinLink = inviteCode ? `${window.location.origin}/join/${inviteCode}` : '';

  return (
    <div
      data-page="host"
      className="h-full overflow-y-auto bg-neutral-950 p-6 text-neutral-100"
    >
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Host a game</h1>
          <ol className="mt-3 flex gap-2 text-xs">
            {STEPS.map((name, i) => (
              <li
                key={name}
                className={`flex-1 rounded border px-2 py-1 text-center ${
                  i + 1 === step
                    ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                    : i + 1 < step
                      ? 'border-neutral-800 text-neutral-500'
                      : 'border-neutral-900 text-neutral-700'
                }`}
              >
                {i + 1}. {name}
              </li>
            ))}
          </ol>
        </header>

        {step === 1 && (
          <section className="flex flex-col gap-4">
            {/* D4 — Quick Host is a copy-paste command, not a child process. */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-sm text-neutral-300">No server yet? Run one:</p>
              <Command value="pnpm --filter @dnd/game-server start" />
              {/* The service docker-compose.yml defines for session/server/Dockerfile. */}
              <Command value="docker compose up game-server" />
              <p className="mt-3 text-xs text-neutral-500">
                It prints an admin pass on first run — that is what goes below.
              </p>
            </div>

            <div>
              <label className={label} htmlFor="server-url">
                Server address
              </label>
              <input
                id="server-url"
                className={field}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:8787"
              />
            </div>

            <div>
              <label className={label} htmlFor="admin-pass">
                Admin pass
              </label>
              <input
                id="admin-pass"
                type="password"
                className={field}
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                autoComplete="off"
              />
            </div>

            <button
              type="button"
              className={primary}
              disabled={!serverUrl.trim() || !adminPass.trim()}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="flex flex-col gap-4">
            <div>
              <label className={label} htmlFor="campaign-name">
                Campaign name
              </label>
              <input
                id="campaign-name"
                className={field}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Untitled campaign"
              />
            </div>
            <button type="button" className={primary} disabled={busy} onClick={createCampaign}>
              {busy ? 'Creating…' : 'Create campaign'}
            </button>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-4">
            <div>
              <label className={label} htmlFor="map-file">
                Map file
              </label>
              <input
                id="map-file"
                type="file"
                accept=".mapbuilder,.json,application/json"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadMap(file);
                }}
                className="w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-neutral-100 hover:file:bg-neutral-700"
              />
              <p className="mt-1 text-xs text-neutral-500">
                A <code>.mapbuilder</code> saved from the editor, up to 20MB.
              </p>
            </div>

            {map && (
              <p data-testid="uploaded-map" className="text-sm text-neutral-300">
                Uploaded <span className="font-medium">{map.name}</span>{' '}
                <span className="text-neutral-500">({(map.sizeBytes / 1024).toFixed(1)} KB)</span>
              </p>
            )}

            <button type="button" className={primary} disabled={!map} onClick={() => setStep(4)}>
              Continue
            </button>
          </section>
        )}

        {step === 4 && (
          <section className="flex flex-col gap-4">
            {!inviteCode ? (
              <button type="button" className={primary} disabled={busy} onClick={openTable}>
                {busy ? 'Opening…' : 'Start session'}
              </button>
            ) : (
              <>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                  <p className={label}>Invite code</p>
                  <div className="flex items-center gap-3">
                    <code
                      data-testid="invite-code"
                      className="font-mono text-2xl tracking-[0.3em] text-neutral-100"
                    >
                      {inviteCode}
                    </code>
                    <CopyButton value={inviteCode} />
                  </div>

                  <p className={`${label} mt-4`}>Join link</p>
                  <div className="flex items-center gap-3">
                    <code className="truncate font-mono text-xs text-neutral-400">{joinLink}</code>
                    <CopyButton value={joinLink} />
                  </div>
                </div>

                <button type="button" className={primary} onClick={enterTable}>
                  Enter table
                </button>
              </>
            )}
          </section>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Command({ value }: { value: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5">
      <code className="flex-1 truncate font-mono text-xs text-neutral-300">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${value}`}
      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
