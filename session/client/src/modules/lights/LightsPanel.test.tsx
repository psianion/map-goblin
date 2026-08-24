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
});
