// M2 table UI (plan design decision 5) — the DM's own "Lights" rail entry. Opening it is what
// "enters" the mode: the body's own effect turns the map's light icons on and starts reading
// clicks/drags off them (`LightEditor.ts`); closing the popover — the rail icon again, Esc, a
// press elsewhere — unmounts the body and tears both back down, the same way every other
// popover close already works (`Popover.tsx`, `hotkeys.ts`'s Esc order). Nothing lights-specific
// had to be taught to either file.
//
// DM only, by `roles` rather than a `railRoles` narrowing: a player must never see this rail
// entry, and there is no on-map fast path for a player to reach it from either (unlike Doors),
// so there is nothing else here that would need the wider role list.
//
// The actual editing controls live in `LightPopover.tsx`, anchored to the clicked icon on the
// map — the same split `DoorPanel`/`DoorMenu` already draw between "the rail's own summary"
// and "the on-map popover with the real controls".

import { useEffect } from 'react';
import { useStore } from '@dnd/core/src/store/store';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';
import { registerPanel } from '../../session/panels';
import { Icon } from '../../shell/icons';
import { mountLightsEditor } from './LightEditor';
import { mapLights } from './lights';

export function LightsBody() {
  useEffect(() => mountWhenEngineReady(mountLightsEditor), []);
  const count = useStore((s) => mapLights(s.layers).length);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Icon name="frame" size={15} />
        Click a light on the map to edit it. Drag it to move.
      </div>
      {count === 0 && <p className="text-xs text-text-secondary">This map has no lights placed.</p>}
    </div>
  );
}

registerPanel({
  id: 'lights',
  title: 'Lights',
  icon: 'lights',
  key: 'L',
  group: 'play',
  roles: ['dm'],
  order: 35,
  component: LightsBody,
});
