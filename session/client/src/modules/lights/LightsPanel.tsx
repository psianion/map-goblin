// M2 table UI (plan design decision 5) — the DM's own "Lights" rail entry. The map side is a
// standing overlay, like the doors' marks: it registers as the panel's `mount`, so the shell
// runs it once per seat that can see this panel (`GameTable.tsx` mounts `usePanels(role)`, and
// `roles` below is DM-only — a player seat never gets the panel, so it never mounts the editor).
// The icons and their clicks/drags are therefore live whether or not this popover is open; the
// popover is a summary, and the real controls are `LightPopover.tsx` on the map.
//
// DM only, by `roles` rather than a `railRoles` narrowing: a player must never see this rail
// entry, and there is no on-map fast path for a player to reach it from either (unlike Doors),
// so there is nothing else here that would need the wider role list.
//
// The actual editing controls live in `LightPopover.tsx`, anchored to the clicked icon on the
// map — the same split `DoorPanel`/`DoorMenu` already draw between "the rail's own summary"
// and "the on-map popover with the real controls".

import { useStore } from '@dnd/core/src/store/store';
import { mountWhenEngineReady } from '../../renderer/overlayLayer';
import { registerPanel } from '../../session/panels';
import { Icon } from '../../shell/icons';
import { mountLightsEditor } from './LightEditor';
import { mapLights } from './lights';

export function LightsBody() {
  const count = useStore((s) => mapLights(s.layers).length);

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Icon name="frame" size={15} className="shrink-0" />
        <span>Click a light on the map to edit it, double-click to switch it on or off. Drag to move.</span>
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
  mount: () => mountWhenEngineReady(mountLightsEditor),
});
