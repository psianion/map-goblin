import { describe, expect, it } from 'vitest';
import { usePanels, useRailPanels } from '../../session/panels';
// Side-effect import — registers the Lights panel, same as `GameTable.tsx`'s own list.
import './LightsPanel';

describe('Lights rail entry', () => {
  it('is DM only — a player gets no rail icon, and the panel is not even in their list', () => {
    expect(useRailPanels('dm').map((p) => p.id)).toContain('lights');
    expect(useRailPanels('player').map((p) => p.id)).not.toContain('lights');
    expect(usePanels('player').map((p) => p.id)).not.toContain('lights');
  });

  // The map side is a standing overlay now, not something the popover turns on: the DM's icons
  // are live from the moment the table loads. `GameTable` mounts every panel `usePanels(role)`
  // hands it, so "registered here" and "DM-only above" together are the whole contract — and a
  // player, having no lights panel at all, never mounts the editor.
  it('mounts its map-side light editor per DM seat, without the popover being opened', () => {
    const lights = usePanels('dm').find((p) => p.id === 'lights');
    expect(typeof lights?.mount).toBe('function');
    const down = lights?.mount?.();
    expect(typeof down).toBe('function');
    (down as () => void)();
    expect(usePanels('player').some((p) => p.mount === lights?.mount)).toBe(false);
  });
});
