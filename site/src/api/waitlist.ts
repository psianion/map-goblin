// POST /api/waitlist on session/server when VITE_WAITLIST_API_URL is set (P5a); the
// in-memory stub below stands in when it isn't, so local dev never needs the server
// running. Same result shape either way — the form doesn't care which one answered.
export type WaitlistResult =
  | { status: 'success'; message: string }
  | { status: 'duplicate'; message: string }
  | { status: 'error'; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGE = {
  success: "Hoarded. You'll hear a knock when the doors open.",
  duplicate: 'Already hoarded. The goblin never forgets an email.',
  error: 'That bounced off the door. Check it and knock again.',
} as const;

const API_BASE = import.meta.env.VITE_WAITLIST_API_URL as string | undefined;

// ponytail: in-memory Set stands in for the real DB unique index; resets on reload.
// Dev-only fallback — set VITE_WAITLIST_API_URL to hit the real endpoint instead.
const seen = new Set<string>();

async function joinWaitlistStub(email: string): Promise<WaitlistResult> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (seen.has(email)) return { status: 'duplicate', message: MESSAGE.duplicate };
  seen.add(email);
  return { status: 'success', message: MESSAGE.success };
}

export async function joinWaitlist(email: string): Promise<WaitlistResult> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { status: 'error', message: MESSAGE.error };
  if (!API_BASE) return joinWaitlistStub(normalized);

  try {
    const res = await fetch(`${API_BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: normalized }),
    });
    // The server 400s an address it disagrees is valid; anything else unreachable-ish
    // (5xx, network) reads the same to a DM as a door that didn't open.
    if (!res.ok) return { status: 'error', message: MESSAGE.error };
    const body = (await res.json()) as { duplicate: boolean };
    return body.duplicate
      ? { status: 'duplicate', message: MESSAGE.duplicate }
      : { status: 'success', message: MESSAGE.success };
  } catch {
    return { status: 'error', message: MESSAGE.error };
  }
}
