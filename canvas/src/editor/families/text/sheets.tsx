// The Text family's sheets for the Sheet surface: the Prep overview, rebuilt from the
// composites, and a zone's sheet (More on its card), whose body comes over as it is.

import { useStore } from '@/store/store';
import { selectLayerForChild } from '@/store/selectors';
import { ZoneSheet } from '@/v2/editor/ZoneSheet';

export { PrepSheet } from './PrepSheet';

/** The zone's triggers, encounter and notes; nothing when the zone has gone. */
export function ZoneSheetBody({ zoneId }: { zoneId: string }) {
  const layerId = useStore((s) => selectLayerForChild(s, zoneId)?.id ?? null);
  if (!layerId) return null;
  return <ZoneSheet layerId={layerId} zoneId={zoneId} />;
}
