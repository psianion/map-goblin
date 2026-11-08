import type { PlayerInfo } from '@dnd/core/src/shared/protocol';

/**
 * The roster without the seats a player left behind on their way back in: a rejoin mints a
 * fresh identity (identityIds are public, so the server never honours a supplied one), and
 * §2.5 keeps the old one listed. A name that is connected again hides its away twin.
 */
export function withoutSupersededSeats(players: readonly PlayerInfo[]): PlayerInfo[] {
  const here = new Set(players.filter((p) => p.connected).map((p) => p.name));
  return players.filter((p) => p.connected || !here.has(p.name));
}

/** Two letters for an avatar: initials of the first two words, or the first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
