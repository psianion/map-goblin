/**
 * A seat's identity colour, the one hue a person carries at the table (decision 3): their
 * avatar, their pings and rulers. Stable per identity, picked from a fixed set.
 */
const SEAT_COLOURS = ['#2f7dd1', '#c2410c', '#15803d', '#9333ea', '#be185d', '#0f766e', '#a16207', '#4f46e5'];

export function seatColour(identityId: string): string {
  let h = 0;
  for (let i = 0; i < identityId.length; i++) h = (h * 31 + identityId.charCodeAt(i)) >>> 0;
  return SEAT_COLOURS[h % SEAT_COLOURS.length]!;
}
