// The DM tokens this browser holds for the table, one per campaign (4.3): the token itself
// under `gg.table.dm.<campaignId>`, and a small index of campaign names and servers beside it
// so the host flow can offer them without asking for the admin pass again.

import { refreshDmToken } from './auth';

const tokenKey = (campaignId: string): string => `gg.table.dm.${campaignId}`;
const INDEX_KEY = 'gg.table.dm.campaigns';

/** A DM token is refreshed once it has less than this left (decision 12). */
export const REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredCampaign {
  campaignId: string;
  name: string;
  /** The game server the token was minted by. */
  server: string;
}

/** When a token runs out, ms since epoch, read off its JSON half; null if it does not read as one. */
export function tokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/');
    const exp = (JSON.parse(atob(payload)) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function readIndex(): StoredCampaign[] {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as StoredCampaign[]).filter((c) => typeof c?.campaignId === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(list: StoredCampaign[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* private mode: the token lasts the tab */
  }
}

export function getDmToken(campaignId: string): string | null {
  try {
    return localStorage.getItem(tokenKey(campaignId));
  } catch {
    return null;
  }
}

export function saveDmToken(campaign: StoredCampaign, token: string): void {
  try {
    localStorage.setItem(tokenKey(campaign.campaignId), token);
  } catch {
    /* ditto */
  }
  writeIndex([campaign, ...readIndex().filter((c) => c.campaignId !== campaign.campaignId)]);
}

export function forgetDmToken(campaignId: string): void {
  try {
    localStorage.removeItem(tokenKey(campaignId));
  } catch {
    /* ditto */
  }
  writeIndex(readIndex().filter((c) => c.campaignId !== campaignId));
}

/** The campaigns this browser holds a DM token for that has not run out, newest first. */
export function storedCampaigns(now = Date.now()): StoredCampaign[] {
  return readIndex().filter((c) => {
    const token = getDmToken(c.campaignId);
    const exp = token ? tokenExp(token) : null;
    return exp !== null && exp > now;
  });
}

/**
 * The campaign's token, refreshed first when it has under a week left. A failed refresh keeps
 * the token it had (it still works until it runs out); null when there is none, or it is spent.
 */
export async function freshDmToken(campaignId: string, now = Date.now()): Promise<string | null> {
  const token = getDmToken(campaignId);
  const exp = token ? tokenExp(token) : null;
  if (!token || exp === null || exp <= now) return null;
  if (exp - now >= REFRESH_WITHIN_MS) return token;
  try {
    const fresh = await refreshDmToken(campaignId, token);
    const known = readIndex().find((c) => c.campaignId === campaignId);
    if (known) saveDmToken(known, fresh.token);
    return fresh.token;
  } catch {
    return token;
  }
}
