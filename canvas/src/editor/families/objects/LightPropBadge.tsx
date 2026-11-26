// The one badge a prop tile carries for a light prop.

import { Lightbulb } from 'lucide-react';
import { lightPropOf } from '@dnd/core/src/assets/packCatalog';

/**
 * A 12 px bulb in the thumb's bottom right, in ink at 60 %, so the strip and the library say
 * which props bring a light. Nothing for any other prop.
 */
export function LightPropBadge({ assetId }: { assetId: string }) {
  if (!lightPropOf(assetId)) return null;
  return (
    // Hidden from the tile's accessible name (the prop's own); the tooltip says what it means.
    <span aria-hidden title="Brings a light" data-testid="light-prop-badge" className="absolute right-[3px] bottom-[3px] flex">
      <Lightbulb strokeWidth={2} className="size-3 text-ink opacity-60" />
    </span>
  );
}
