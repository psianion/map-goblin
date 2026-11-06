// The brush colour as one value: the tint and how strongly it colours the stroke, written
// as #rrggbbaa. The store keeps them apart (tintColor, tintOpacity); this is the one
// control's view of the pair.

const HEX8 = /^#[0-9a-f]{8}$/i;

export function isHex8(v: string): boolean {
  return HEX8.test(v);
}

/** #rrggbb and 0 to 1 as #rrggbbaa. */
export function toHex8(colour: string, alpha: number): string {
  const rgb = /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : '#ffffff';
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${rgb}${a.toString(16).padStart(2, '0')}`;
}

/** #rrggbbaa as the colour and its alpha, 0 to 1, kept to hundredths. */
export function fromHex8(v: string): { colour: string; alpha: number } {
  return { colour: v.slice(0, 7).toLowerCase(), alpha: Math.round((parseInt(v.slice(7, 9), 16) / 255) * 100) / 100 };
}
