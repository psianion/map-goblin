import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAP_FILE_ACCEPT } from '@dnd/core/src/shared/mapFile';
import { useStore } from '@dnd/core/src/store/store';
import { Button, Caption, FloatBox, Input, PrimaryButton, Tile, cn, timeAgo } from '@dnd/ui';
import { ArrowLeft, FilePlus2, Upload } from '@dnd/ui/icons';
import { endpoints, setServerUrl } from '../endpoints';
import { navigate } from '../router';
import {
  createCampaignAsDm,
  fetchActiveSession,
  fetchMapDoc,
  listCampaignsAsAdmin,
  listScenes,
  mintDmToken,
  redeemHandoff,
  startSession,
  uploadMapFile,
  type CampaignSummary,
  type SceneMeta,
} from '../session/auth';
import { forgetDmToken, freshDmToken, saveDmToken, storedCampaigns, type StoredCampaign } from '../session/dmTokens';
import { readMapFile } from '../session/mapFile';
import { useSessionStore } from '../session/store';
import { inviteLink } from '../shell/top/inviteCode';
import { startingRoomsOf, type StartingRoomOption } from './startingRoom';

type Step = 'connect' | 'campaign' | 'map' | 'invite';

const STEPS: { id: Exclude<Step, 'connect'>; label: string }[] = [
  { id: 'campaign', label: 'Campaign' },
  { id: 'map', label: 'Map' },
  { id: 'invite', label: 'Invite' },
];

interface Campaign {
  campaignId: string;
  name: string;
  token: string;
}

/** Anything typed into the server field must be an address the browser can reach. */
function serverUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const { protocol } = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error('scheme');
  } catch {
    return 'That is not an address the browser can reach. Try http://localhost:5620';
  }
  return null;
}

/** `#handoff=<code>` from the canvas's Open the table. */
function readHandoffCode(): string | null {
  const match = /(?:^#|&)handoff=([^&]+)/.exec(window.location.hash);
  return match ? decodeURIComponent(match[1]!) : null;
}

function clearHandoffCode(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/**
 * The code is single use, and the page can mount more than once for one load (StrictMode in
 * dev runs effects twice): every mount for the same code shares the one redeem.
 */
const redeems = new Map<string, ReturnType<typeof redeemHandoff>>();
function redeemOnce(code: string): ReturnType<typeof redeemHandoff> {
  let pending = redeems.get(code);
  if (!pending) {
    pending = redeemHandoff(code);
    redeems.set(code, pending);
  }
  return pending;
}

/** A blank map: the editor's own default document, under a plain name. */
function blankMapText(): string {
  const core = useStore.getState();
  core.resetToDefault();
  const doc = core.getSerializableState();
  return JSON.stringify({ ...doc, mapSettings: { ...doc.mapSettings, name: 'Blank map' } });
}

function Stepper({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-2 text-xs" data-testid="host-steps">
      {STEPS.map((s, i) => (
        <li key={s.id} className={cn('flex items-center gap-2', i === at ? 'text-text' : 'text-text-3')} aria-current={i === at ? 'step' : undefined}>
          <span className={cn('flex size-5 items-center justify-center rounded-pill border font-mono', i <= at ? 'border-ink' : 'border-line')}>{i + 1}</span>
          {s.label}
          {i < STEPS.length - 1 && <span aria-hidden className="text-text-3">→</span>}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, onBack, children, testId }: { title: string; onBack?: () => void; children: ReactNode; testId: string }) {
  return (
    <section className="flex flex-col gap-4" data-testid={testId}>
      <div className="flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="sm" data-testid="host-back" onClick={onBack}>
            <ArrowLeft aria-hidden strokeWidth={1.75} className="size-4" />
            Back
          </Button>
        )}
        <h2 className="text-base font-medium text-text">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/**
 * Board 7: the DM's host flow. Campaign → Map → Invite, each with Back. The server and pass
 * step only shows while this browser holds no valid DM token, and "Different DM or new
 * campaign" always brings it back. A `#handoff=` from the canvas lands on the Map step with
 * the campaign chosen.
 */
export default function HostSetup() {
  const [step, setStep] = useState<Step>(() => (storedCampaigns().length > 0 ? 'campaign' : 'connect'));
  const [serverUrl, setServerField] = useState(endpoints.httpBase);
  const [adminPass, setAdminPass] = useState('');
  const [serverCampaigns, setServerCampaigns] = useState<CampaignSummary[] | null>(null);
  const [newName, setNewName] = useState('');
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<StartingRoomOption[]>([]);
  const [startRoomId, setStartRoomId] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const handoff = useRef(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
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

  const resolvedServer = serverUrl.trim() || endpoints.httpBase;
  const serverError = serverUrlError(serverUrl);

  /** A campaign in hand: a table already live resumes on Invite, else its library opens on Map. */
  const enterCampaign = async (c: Campaign, resumeLive = true): Promise<void> => {
    setCampaign(c);
    setSceneId(null);
    setRooms([]);
    setStartRoomId('');
    const active = resumeLive ? await fetchActiveSession(c.campaignId, c.token).catch(() => null) : null;
    if (active) {
      setInviteCode(active.inviteCode);
      setResumed(true);
      setStep('invite');
      return;
    }
    setResumed(false);
    setInviteCode(null);
    setScenes((await listScenes(c.campaignId, c.token)).scenes);
    setStep('map');
  };

  // The canvas handed the DM over: redeem the code once, keep the token, open its library.
  useEffect(() => {
    if (handoff.current) return;
    handoff.current = true;
    const code = readHandoffCode();
    if (!code) return;
    void run(async () => {
      const res = await redeemOnce(code);
      clearHandoffCode();
      saveDmToken({ campaignId: res.campaignId, name: res.campaignName, server: endpoints.httpBase }, res.token);
      await enterCampaign({ campaignId: res.campaignId, name: res.campaignName, token: res.token }, false);
    });
    // Once, on load.
  }, []);

  const connect = () =>
    run(async () => {
      const { campaigns } = await listCampaignsAsAdmin(resolvedServer, adminPass);
      setServerCampaigns(campaigns);
      setStep('campaign');
    });

  const pickStored = (c: StoredCampaign) =>
    run(async () => {
      setServerUrl(c.server);
      const token = await freshDmToken(c.campaignId);
      if (!token) {
        forgetDmToken(c.campaignId);
        throw new Error(`The pass for ${c.name} has run out. Sign in as the DM again.`);
      }
      await enterCampaign({ campaignId: c.campaignId, name: c.name, token });
    });

  const pickServerCampaign = (c: CampaignSummary) =>
    run(async () => {
      const session = await mintDmToken(resolvedServer, adminPass, c.id);
      saveDmToken({ campaignId: c.id, name: c.name, server: endpoints.httpBase }, session.token);
      await enterCampaign({ campaignId: c.id, name: c.name, token: session.token });
    });

  const createCampaign = () =>
    run(async () => {
      const name = newName.trim() || 'Untitled campaign';
      const session = await createCampaignAsDm(resolvedServer, adminPass, name);
      saveDmToken({ campaignId: session.campaignId, name, server: endpoints.httpBase }, session.token);
      await enterCampaign({ campaignId: session.campaignId, name, token: session.token }, false);
    });

  const pickScene = (id: string) =>
    run(async () => {
      if (!campaign) return;
      setSceneId(id);
      const picker = startingRoomsOf(await fetchMapDoc(id, campaign.token));
      setRooms(picker.rooms);
      setStartRoomId(picker.defaultRoomId);
    });

  const uploadText = (text: string) =>
    run(async () => {
      if (!campaign) return;
      const uploaded = await uploadMapFile(campaign.campaignId, campaign.token, text);
      setScenes((await listScenes(campaign.campaignId, campaign.token)).scenes);
      setSceneId(uploaded.sceneId);
      const picker = startingRoomsOf(JSON.parse(text));
      setRooms(picker.rooms);
      setStartRoomId(picker.defaultRoomId);
    });

  const openTable = () =>
    run(async () => {
      if (!campaign || !sceneId) return;
      const startingRoom = startRoomId ? { sceneId, roomId: startRoomId } : undefined;
      const opened = await startSession(campaign.campaignId, campaign.token, startingRoom, sceneId);
      setInviteCode(opened.inviteCode);
      setResumed(false);
      setStep('invite');
    });

  const enterTable = () => {
    if (!campaign || !inviteCode) return;
    const store = useSessionStore.getState();
    store.setInviteCode(inviteCode);
    store.connect(campaign.token);
    navigate('/table');
  };

  const stored = storedCampaigns();
  const differentDm = (
    <Button variant="link" size="sm" className="self-start px-0" data-testid="host-different-dm" onClick={() => setStep('connect')}>
      Different DM or new campaign
    </Button>
  );

  return (
    <div data-page="host" className="flex h-full justify-center overflow-y-auto bg-bg p-6 text-text">
      <div className="flex w-full max-w-2xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-medium">Host a game</h1>
          {step !== 'connect' && <Stepper step={step} />}
        </header>

        <FloatBox className="flex flex-col gap-4 p-5">
          {step === 'connect' && (
            <Section title="Your server and pass" testId="host-connect" onBack={stored.length > 0 ? () => setStep('campaign') : undefined}>
              <p className="text-xs text-text-2">
                The game server prints an admin pass the first time it starts (<code className="font-mono">docker compose logs game-server</code>). It is
                only asked for once: this browser keeps a DM pass per campaign for 30 days.
              </p>
              <label className="flex flex-col gap-1 text-xs text-text-2" htmlFor="server-url">
                Server address
                <Input id="server-url" value={serverUrl} placeholder={endpoints.httpBase} onChange={(e) => setServerField(e.target.value)} />
              </label>
              {serverError && (
                <p className="text-xs text-danger" data-testid="server-url-error">
                  {serverError}
                </p>
              )}
              <label className="flex flex-col gap-1 text-xs text-text-2" htmlFor="admin-pass">
                Admin pass
                <Input id="admin-pass" type="password" autoComplete="off" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} />
              </label>
              <PrimaryButton className="self-start" disabled={!adminPass.trim() || serverError !== null || busy} onClick={connect}>
                {busy ? 'Checking…' : 'Continue'}
              </PrimaryButton>
            </Section>
          )}

          {step === 'campaign' && (
            <Section title="Pick a campaign" testId="host-campaign">
              {stored.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2" data-testid="host-stored-campaigns">
                  {stored.map((c) => (
                    <li key={c.campaignId}>
                      <Button variant="outline" className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2" disabled={busy} onClick={() => pickStored(c)}>
                        <span className="text-sm text-text">{c.name}</span>
                        <span className="font-mono text-xs text-text-3">{c.server}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {serverCampaigns && serverCampaigns.length > 0 && (
                <>
                  <Caption>On this server</Caption>
                  <ul className="grid gap-2 sm:grid-cols-2" data-testid="host-server-campaigns">
                    {serverCampaigns.map((c) => (
                      <li key={c.id}>
                        <Button variant="outline" className="h-auto w-full flex-col items-start px-3 py-2" disabled={busy} onClick={() => pickServerCampaign(c)}>
                          <span className="text-sm text-text">{c.name}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {serverCampaigns && (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createCampaign();
                  }}
                >
                  <Caption>New campaign</Caption>
                  <div className="flex gap-2">
                    <Input id="campaign-name" placeholder="Cragmaw Hideout" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <PrimaryButton type="submit" disabled={busy}>
                      Create campaign
                    </PrimaryButton>
                  </div>
                </form>
              )}
              {differentDm}
            </Section>
          )}

          {step === 'map' && campaign && (
            <Section title={`Pick a map for ${campaign.name}`} testId="host-map" onBack={() => setStep('campaign')}>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="host-library">
                {scenes.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-testid="library-card"
                      aria-pressed={sceneId === s.id}
                      disabled={busy}
                      onClick={() => pickScene(s.id)}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-control border border-line p-2 text-left hover:bg-panel-2',
                        sceneId === s.id && 'ring-1 ring-inset ring-ink',
                      )}
                    >
                      <span aria-hidden className="flex h-20 items-center justify-center rounded-key bg-panel-2 text-lg text-text-3">
                        {s.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="truncate text-xs text-text">{s.name}</span>
                      <span className="text-xs text-text-3">Published {timeAgo(s.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {scenes.length === 0 && <p className="text-xs text-text-3">Nothing published yet. Publish from the canvas, or bring a file.</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={busy} data-testid="host-upload" onClick={() => fileInput.current?.click()}>
                  <Upload aria-hidden strokeWidth={1.75} />
                  Upload file
                </Button>
                <input
                  ref={fileInput}
                  id="map-file"
                  type="file"
                  accept={MAP_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void readMapFile(file).then(uploadText, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
                  }}
                />
                <Button variant="outline" size="sm" disabled={busy} data-testid="host-blank" onClick={() => void uploadText(blankMapText())}>
                  <FilePlus2 aria-hidden strokeWidth={1.75} />
                  Blank map
                </Button>
              </div>
              {sceneId && (
                <div className="flex flex-col gap-2" data-testid="host-starting-room">
                  <Caption>Starting room</Caption>
                  <div className="flex flex-wrap gap-2">
                    <Tile name="Start dark" active={startRoomId === ''} onClick={() => setStartRoomId('')} data-testid="start-room-none" />
                    {rooms.map((r) => (
                      <Tile key={r.id} name={r.label} active={startRoomId === r.id} data-testid="start-room" data-room-id={r.id} onClick={() => setStartRoomId(r.id)} />
                    ))}
                  </div>
                  <PrimaryButton className="self-start" disabled={busy} data-testid="host-open" onClick={openTable}>
                    Open the table
                  </PrimaryButton>
                </div>
              )}
            </Section>
          )}

          {step === 'invite' && campaign && inviteCode && (
            <Section title={resumed ? 'Your table is already open' : 'Invite your players'} testId="host-invite" onBack={() => setStep('map')}>
              <div className="flex gap-5">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Caption>Invite code</Caption>
                  <code data-testid="invite-code" className="font-mono text-4xl tracking-widest text-text">
                    {inviteCode}
                  </code>
                  <span className="truncate font-mono text-xs text-text-2" data-testid="invite-link">
                    {inviteLink(inviteCode)}
                  </span>
                </div>
                {/* No QR encoder in the repo yet: the box holds the place, the code and link carry the invite. */}
                <div data-testid="invite-qr" aria-label="QR code" className="flex size-36 shrink-0 items-center justify-center rounded-control border border-dashed border-line-strong text-xs text-text-3">
                  QR
                </div>
              </div>
              <PrimaryButton className="self-start" data-testid="enter-table" onClick={enterTable}>
                Enter table
              </PrimaryButton>
            </Section>
          )}

          {error && (
            <p role="alert" className="text-xs text-danger" data-testid="host-error">
              {error}
            </p>
          )}
        </FloatBox>
      </div>
    </div>
  );
}
