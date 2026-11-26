// Table fix pass F2 — the seat this browser last sat in, per campaign, so a player who closed the
// tab (or whose table was reopened) is offered "Continue as Pim" instead of starting over. Kept
// in localStorage, unlike the per-tab `mg-seat`, because it has to outlive the tab.

export interface RememberedSeat {
  name: string;
  identityId: string;
  token: string;
  sessionId: string;
  /** The invite code the seat was taken with; seats remembered before it was kept have none. */
  code?: string;
}

const keyOf = (campaignId: string): string => `gg.table.seat.${campaignId}`;

/** The seat last taken at this campaign's table in this browser, or null. */
export function rememberedSeat(campaignId: string): RememberedSeat | null {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(campaignId)) ?? 'null') as Partial<RememberedSeat> | null;
    if (!raw || typeof raw.name !== 'string' || typeof raw.token !== 'string' || typeof raw.sessionId !== 'string') return null;
    return {
      name: raw.name,
      identityId: String(raw.identityId ?? ''),
      token: raw.token,
      sessionId: raw.sessionId,
      ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
    };
  } catch {
    return null;
  }
}

export function rememberSeat(campaignId: string, seat: RememberedSeat): void {
  try {
    localStorage.setItem(keyOf(campaignId), JSON.stringify(seat));
  } catch {
    /* storage unavailable: the next visit asks for a name again */
  }
}
