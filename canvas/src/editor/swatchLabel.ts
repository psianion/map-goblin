/** The label a setting or card field's swatches take: its own, except in the dock, where the column is captioned. */
export function swatchLabel(def: { label: string; home: string }): string | undefined {
  return def.home === 'dock' ? undefined : def.label;
}
