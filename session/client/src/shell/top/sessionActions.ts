import { endpoints } from '../../endpoints';
import { navigate } from '../../router';
import { useSessionStore } from '../../session/store';

/** The `table` module's switches, once the server has the module; undefined before. */
export interface TableSwitches {
  paused?: boolean;
  movementLocked?: boolean;
}

/** Pause the table or lock token movement (4.3): DM commands on the `table` module. */
export function setTableSwitch(action: 'pause' | 'lock-movement', on: boolean): void {
  useSessionStore.getState().sendCommand('table', action, { on });
}

/** A player leaves: the seat's socket closed and back to the start page. */
export function leaveTable(): void {
  useSessionStore.getState().disconnect();
  navigate('/');
}

/** Assign a token on the live scene to a seat, or take it back (`identityId: null`). */
export function assignToken(tokenId: string, identityId: string | null): void {
  useSessionStore.getState().sendCommand('tokens', 'assign', { id: tokenId, identityId });
}

/**
 * Download the campaign archive (`GET /api/campaigns/:id/export`, DM token). Resolves to an
 * error line for the menu, or null once the file is on its way.
 */
export async function exportCampaign(): Promise<string | null> {
  const { session, token } = useSessionStore.getState();
  if (!session || !token) return 'Not connected to a table.';
  let res: Response;
  try {
    res = await fetch(`${endpoints.httpBase}/api/campaigns/${encodeURIComponent(session.campaignId)}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return 'The server could not be reached.';
  }
  if (res.status === 404) return 'This server cannot export campaigns yet.';
  if (!res.ok) return `Export failed (${res.status}).`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `campaign-${session.campaignId.slice(0, 8)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}
