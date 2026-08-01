// §2.6 — the host flow's starting room. The picker is the only decision in setup that is
// about *play*, so what is pinned here is the wiring, not the markup: the room the DM chose
// has to arrive on the call that opens the table, because that call is the only moment the
// server can light it before anyone is in the door.

import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HostSetup from './HostSetup';

vi.mock('../session/auth', () => ({
  createCampaignAsDm: vi.fn(),
  uploadMapFile: vi.fn(),
  startSession: vi.fn(),
}));
const { createCampaignAsDm, uploadMapFile, startSession } = await import('../session/auth');

/** Two rooms, one of them unnamed — the label fallback has to have something to fall to. */
const MAP = {
  version: '3.0',
  mapSettings: { name: 'Emberhold Crypt' },
  grid: {},
  layers: [
    {
      id: 'layer-1',
      type: 'dungeon',
      rooms: [
        { id: 'r-vestibule', name: 'Vestibule of Ash', isPathway: false },
        { id: 'r-nameless', name: '', isPathway: false },
      ],
    },
  ],
};

beforeEach(() => {
  cleanup();
  vi.mocked(createCampaignAsDm).mockReset().mockResolvedValue({
    campaignId: 'c1',
    identityId: 'dm-1',
    token: 'dm-token',
  });
  vi.mocked(uploadMapFile).mockReset().mockResolvedValue({
    mapId: 'map-1',
    name: 'Emberhold Crypt',
    sizeBytes: 2048,
  });
  vi.mocked(startSession).mockReset().mockResolvedValue({
    sessionId: 's1',
    campaignId: 'c1',
    inviteCode: 'ABC234',
  });
});

/** Server → campaign → the uploaded map, which is where the picker appears. */
async function walkToMap(): Promise<void> {
  render(<HostSetup />);

  fireEvent.change(screen.getByLabelText('Server address'), {
    target: { value: 'http://localhost:8787' },
  });
  fireEvent.change(screen.getByLabelText('Admin pass'), { target: { value: 'hunter2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Cragmaw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
  await screen.findByLabelText('Map file');

  const file = new File([JSON.stringify(MAP)], 'crypt.mapbuilder', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Map file'), { target: { files: [file] } });
  await screen.findByTestId('uploaded-map');
}

/** …and on to the invite step, which is the one that opens the table. */
async function startTable(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }));
  await screen.findByTestId('invite-code');
}

describe('HostSetup — the map file', () => {
  /**
   * The editor saves `MPBLD\0` + gzip(JSON), and the wizard used to read it with
   * `file.text()` — which mangles the bytes, so the upload was refused and the room picker
   * never appeared. The file here is the real container, not a stand-in.
   */
  it('takes the editor’s gzipped save and still offers its rooms', async () => {
    render(<HostSetup />);
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'http://localhost:8787' },
    });
    fireEvent.change(screen.getByLabelText('Admin pass'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    await screen.findByLabelText('Map file');

    const json = JSON.stringify(MAP);
    const bytes = Buffer.concat([Buffer.from('MPBLD\0', 'latin1'), gzipSync(Buffer.from(json, 'utf8'))]);
    const file = new File([bytes], 'crypt.mapbuilder');
    fireEvent.change(screen.getByLabelText('Map file'), { target: { files: [file] } });
    await screen.findByTestId('uploaded-map');

    // The server is handed the decoded JSON, not the container bytes.
    expect(vi.mocked(uploadMapFile).mock.calls[0][2]).toBe(json);

    const picker = await screen.findByLabelText<HTMLSelectElement>('Starting room');
    expect([...picker.options].map((o) => o.text)).toContain('Vestibule of Ash');
  });
});

describe('HostSetup — the starting room', () => {
  it('sends the room the DM picked with the call that opens the table', async () => {
    await walkToMap();

    // The list is the map's own rooms, in the map's own words.
    const picker = await screen.findByLabelText<HTMLSelectElement>('Starting room');
    expect([...picker.options].map((o) => o.text)).toEqual([
      'None — the map starts dark',
      'Vestibule of Ash',
      // An unnamed room is still a room a DM can start the party in.
      'Room 2',
    ]);

    fireEvent.change(picker, { target: { value: 'r-vestibule' } });
    await startTable();

    // The scene id is the uploaded map's id: fog is stored per scene, and a scene is a map.
    await waitFor(() =>
      expect(startSession).toHaveBeenCalledWith(
        'c1',
        'dm-token',
        { sceneId: 'map-1', roomId: 'r-vestibule' },
        'map-1',
      ),
    );
  });

  it('sends nothing when the DM skips it, and the table starts dark as before', async () => {
    await walkToMap();
    expect((await screen.findByLabelText<HTMLSelectElement>('Starting room')).value).toBe('');

    await startTable();

    // No room, but still the scene: the table has to open on the map just uploaded even
    // when the DM lights nothing in it, or a campaign with an older map opens on that one.
    await waitFor(() =>
      expect(startSession).toHaveBeenCalledWith('c1', 'dm-token', undefined, 'map-1'),
    );
  });

  it('offers no picker for a map nobody zoned', async () => {
    vi.mocked(uploadMapFile).mockResolvedValue({ mapId: 'map-2', name: 'Bare', sizeBytes: 12 });
    render(<HostSetup />);

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'http://localhost:8787' },
    });
    fireEvent.change(screen.getByLabelText('Admin pass'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    await screen.findByLabelText('Map file');

    const bare = new File(
      [JSON.stringify({ ...MAP, layers: [{ id: 'l', type: 'dungeon', rooms: [] }] })],
      'bare.mapbuilder',
      { type: 'application/json' },
    );
    fireEvent.change(screen.getByLabelText('Map file'), { target: { files: [bare] } });
    await screen.findByTestId('uploaded-map');

    expect(screen.queryByLabelText('Starting room')).toBeNull();
  });
});
