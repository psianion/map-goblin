import { useState } from 'react';
import type { Room } from '@dnd/core/src/shared/types';
import { endpoints } from '../endpoints';
import { serverRooms } from '../modules/fog/fog';
import { navigate } from '../router';
import {
  createCampaignAsDm,
  listCampaignsAsAdmin,
  listScenes,
  mintDmToken,
  startSession,
  uploadMapFile,
  type CampaignSummary,
  type DmSession,
  type SceneMeta,
} from '../session/auth';
import { readMapFile } from '../session/mapFile';
import { useSessionStore } from '../session/store';

const STEPS = ['Server', 'Campaign', 'Map', 'Invite'];

/**
 * The server address is optional, exactly as the field's own helper copy promises: leave it
 * empty and the server is this page's origin, which in the deployed stack is the right
 * answer (nginx proxies /api and /ws to the game server). Only something actually typed is
 * validated — a blank field used to disable Continue, which contradicted the copy directly.
 *
 * `setServerUrl` assumes http:// for a bare `host:port`, so the same leniency applies here;
 * anything that still will not parse is a typo worth naming before a request is fired at it.
 */
function serverUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const { protocol } = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error('scheme');
  } catch {
    return 'That is not an address the browser can reach — try http://localhost:8787';
  }
  return null;
}

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
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [dm, setDm] = useState<DmSession | null>(null);
  const [map, setMap] = useState<{ mapId: string; name: string; sizeBytes: number } | null>(null);
  /** The campaign's published library, fetched once its DM token is in hand (M3). */
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  /** A library scene picked instead of uploading — mutually exclusive with `map`. */
  const [selectedSceneId, setSelectedSceneId] = useState('');
  /** The uploaded map's own rooms — the same list the fog panel will show at the table. */
  const [rooms, setRooms] = useState<Room[]>([]);
  /** '' = none, which is the table starting dark exactly as it did before this picker. */
  const [startRoomId, setStartRoomId] = useState('');
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

  /** Empty means this page's own origin — the default the field's helper copy describes. */
  const resolvedServerUrl = serverUrl.trim() || endpoints.httpBase;
  const serverError = serverUrlError(serverUrl);

  /** Fetches the campaign's list to decide the Server step to leave off on. */
  const continueFromServer = () =>
    run(async () => {
      const { campaigns } = await listCampaignsAsAdmin(resolvedServerUrl, adminPass);
      setCampaigns(campaigns);
      setStep(2);
    });

  /** Shared tail of both campaign paths: a DM token in hand, its library fetched next. */
  const enterMapStep = async (session: DmSession): Promise<void> => {
    setDm(session);
    setScenes((await listScenes(session.campaignId, session.token)).scenes);
    setStep(3);
  };

  const createCampaign = () =>
    run(async () => {
      const session = await createCampaignAsDm(
        resolvedServerUrl,
        adminPass,
        campaignName || 'Untitled campaign',
      );
      await enterMapStep(session);
    });

  const hostExisting = (campaign: CampaignSummary) =>
    run(async () => {
      await enterMapStep(await mintDmToken(resolvedServerUrl, adminPass, campaign.id));
    });

  const pickScene = (sceneId: string) => {
    setSelectedSceneId(sceneId);
    // Uploading and picking from the library are mutually exclusive — whichever was
    // chosen last is the one that opens the table.
    setMap(null);
    setRooms([]);
    setStartRoomId('');
  };

  const uploadMap = (file: File) =>
    run(async () => {
      if (!dm) return;
      // The editor's own save is gzipped (`readMapFile`); a testdata fixture is plain JSON.
      const text = await readMapFile(file);
      setMap(await uploadMapFile(dm.campaignId, dm.token, text));
      setSelectedSceneId('');
      // Only reached once the server has accepted the same bytes, so it parses here too.
      setRooms(serverRooms(JSON.parse(text)));
      setStartRoomId('');
    });

  const openTable = () =>
    run(async () => {
      if (!dm) return;
      // A scene *is* a map: the id the upload handed back (or the library scene picked
      // instead) is the one fog is keyed by, and the one the table has to open on — a
      // campaign may already hold others.
      const sceneId = selectedSceneId || map?.mapId;
      const startingRoom =
        map && startRoomId ? { sceneId: map.mapId, roomId: startRoomId } : undefined;
      const opened = await startSession(dm.campaignId, dm.token, startingRoom, sceneId);
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
                placeholder={endpoints.httpBase}
              />
              {/*
                The pre-filled value is this page's own origin, and in the deployed stack
                that is the right answer: nginx reverse-proxies /api and /ws to the game
                server, so the browser only ever talks to one origin (nginx.conf). The
                placeholder used to say :8787 while the field held :8090, which read as a
                wrong default and sent a gate walk hunting for a bug that was not there.
              */}
              <p className="mt-1 text-xs text-neutral-500">
                Optional — pre-filled with this page’s own address, which is where the server
                answers unless you are running it somewhere else. Empty means the same thing.
              </p>
              {serverError && (
                <p className="mt-1 text-xs text-red-400" data-testid="server-url-error">
                  {serverError}
                </p>
              )}
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
              disabled={!adminPass.trim() || serverError !== null || busy}
              onClick={continueFromServer}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="flex flex-col gap-4">
            {/*
              #M3 — hosting an existing campaign is the primary path once one exists: its
              library was already built in the map editor. A brand-new server has no
              campaigns yet, so this list is simply absent rather than an empty state
              nobody needs to read past — the create form below is exactly today's step.
            */}
            {campaigns.length > 0 && (
              <div>
                <p className={label}>Host an existing campaign</p>
                <ul aria-label="Existing campaigns" className="flex flex-col gap-1">
                  {campaigns.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void hostExisting(c)}
                        className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-left text-sm hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="font-medium text-neutral-100">{c.name}</span>
                        <span className="ml-2 text-xs text-neutral-500">
                          Created {new Date(c.createdAt).toLocaleDateString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-neutral-500">
                  Picking one opens its scene library on the next step.
                </p>
              </div>
            )}

            <div>
              <label className={label} htmlFor="campaign-name">
                {campaigns.length > 0 ? 'Or start a new campaign' : 'Campaign name'}
              </label>
              <input
                id="campaign-name"
                className={field}
                value={campaignName}
                disabled={busy}
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
            {/*
              M3 — library-first: a campaign whose scenes came from the map editor should
              open on one of them, not send the DM hunting for the file again. A fresh
              campaign has nothing here yet, so this fieldset is simply absent and upload
              is the only option — exactly today's step.
            */}
            {scenes.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className={label}>Choose a scene from the library</legend>
                <div className="flex flex-col gap-1">
                  {scenes.map((scene) => (
                    <label
                      key={scene.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-neutral-400 ${
                        selectedSceneId === scene.id
                          ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                          : 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="library-scene"
                        value={scene.id}
                        checked={selectedSceneId === scene.id}
                        onChange={() => pickScene(scene.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">{scene.name}</span>
                      {!scene.visibleToPlayers && (
                        <span className="shrink-0 text-xs text-neutral-500">Hidden</span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-neutral-500">
                  Opens the table on this scene. Switch scenes any time once you're at the table.
                </p>
              </fieldset>
            )}

            <div>
              <label className={label} htmlFor="map-file">
                {scenes.length > 0 ? 'Or import a map file' : 'Map file'}
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
                {scenes.length > 0 ? (
                  <>A backup path — most tables are already in the library above.</>
                ) : (
                  <>
                    A <code>.mapbuilder</code> saved from the editor, up to 20MB.
                  </>
                )}
              </p>
            </div>

            {map && (
              <p data-testid="uploaded-map" className="text-sm text-neutral-300">
                Uploaded <span className="font-medium">{map.name}</span>{' '}
                <span className="text-neutral-500">({(map.sizeBytes / 1024).toFixed(1)} KB)</span>
              </p>
            )}

            {/*
              The one thing worth deciding before the table opens. Everything else about fog
              is a click at the table, but the first room is the one nobody is there to
              reveal: without it the party's first minute is a black canvas they cannot move
              a token on. Skipping is the old behaviour, so the default stays "none".
            */}
            {map && rooms.length > 0 && (
              <div>
                <label className={label} htmlFor="starting-room">
                  Starting room
                </label>
                <select
                  id="starting-room"
                  className={field}
                  value={startRoomId}
                  onChange={(e) => setStartRoomId(e.target.value)}
                >
                  <option value="">None — the map starts dark</option>
                  {rooms.map((room, i) => (
                    <option key={room.id} value={room.id}>
                      {room.name || `Room ${i + 1}`}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-neutral-500">
                  Revealed when players join. Every other room stays dark until you reveal it.
                </p>
              </div>
            )}

            <button
              type="button"
              className={primary}
              disabled={!map && !selectedSceneId}
              onClick={() => setStep(4)}
            >
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
