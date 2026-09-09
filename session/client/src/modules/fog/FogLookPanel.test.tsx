// D7/WP2 — the Fog look panel: provenance off the map's authored default, and every dial
// sending the debounced (or, for a one-shot pick, immediate) `set-fog-look` command.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import { createDefaultState } from '@dnd/core/src/store/factories';
import type { FogState } from '@dnd/mechanics/fog';
import { useSessionStore } from '../../session/store';
import { usePanel, usePanels } from '../../session/panels';
import { FogLookPanel } from './FogLookPanel';
import { DEFAULT_FOG_LOOK, FOG_PRESETS } from './livingFog';

function session(activeSceneId: string | null, modules: SessionState['modules'] = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes: activeSceneId ? [{ id: activeSceneId, name: 'Fieldstone Keep', mapId: 'm1' }] : [],
    players: [],
    modules,
  };
}

function fogState(look?: FogState['byScene'][string]['look']): FogState {
  return { byScene: { 'sc-1': { rooms: {}, concealBehindDoors: true, ...(look ? { look } : {}) } } };
}

beforeEach(() => {
  cleanup();
  // `vi.spyOn` on an already-spied method returns the same mock with its history intact
  // (vitest has no auto-restore by default), and every test here re-spies the one store
  // method — so without this, a later test's "not called" assertion would be reading a
  // previous test's calls.
  vi.restoreAllMocks();
  useStore.setState({ mapSettings: { ...createDefaultState().mapSettings, fogLook: undefined } });
  useSessionStore.setState({ session: session('sc-1', { fog: fogState() }) });
});

describe('FogLookPanel', () => {
  it('is registered DM-only', () => {
    expect(usePanels('dm').find((p) => p.id === 'fog-look')?.roles).toEqual(['dm']);
    expect(usePanels('player').some((p) => p.id === 'fog-look')).toBe(false);
    expect(usePanel('fog-look')).toBeDefined();
  });

  it('asks for a scene before offering any dial', () => {
    useSessionStore.setState({ session: session(null) });
    render(<FogLookPanel />);
    expect(screen.getByText('Activate a scene to set its fog look.')).not.toBeNull();
    expect(screen.queryByTestId('fog-look-wind')).toBeNull();
  });

  it('reads the provenance off the map, naming the preset it authored', () => {
    useStore.setState({
      mapSettings: { ...useStore.getState().mapSettings, fogLook: { ...DEFAULT_FOG_LOOK, preset: 'mist' } },
    });
    render(<FogLookPanel />);
    expect(screen.getByTestId('fog-look-provenance').textContent).toBe('From the map: Mist');
  });

  it('calls an authored mix with no preset tag a custom mix', () => {
    useStore.setState({
      mapSettings: { ...useStore.getState().mapSettings, fogLook: { ...DEFAULT_FOG_LOOK } },
    });
    render(<FogLookPanel />);
    expect(screen.getByTestId('fog-look-provenance').textContent).toBe('From the map: custom mix');
  });

  it('names the shader default when the map has never set a look at all', () => {
    render(<FogLookPanel />);
    // No fogLook authored at all ⇒ falls to DEFAULT_FOG_LOOK, which carries no preset.
    expect(screen.getByTestId('fog-look-provenance').textContent).toBe('Default look, the map has not set one');
    expect((screen.getByTestId('fog-look-wind') as HTMLInputElement).value).toBe(String(DEFAULT_FOG_LOOK.wind));
  });

  it('sends a preset pick immediately, with the preset’s own layers', () => {
    render(<FogLookPanel />);
    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    fireEvent.click(screen.getByRole('radio', { name: 'Cumulus' }));
    expect(sendCommand).toHaveBeenCalledWith('fog', 'set-fog-look', {
      look: { preset: 'cumulus', layers: FOG_PRESETS.cumulus },
    });
  });

  it('sends the heavy toggle immediately', () => {
    render(<FogLookPanel />);
    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    fireEvent.click(screen.getByTestId('fog-look-heavy'));
    expect(sendCommand).toHaveBeenCalledWith('fog', 'set-fog-look', { look: { heavy: true } });
  });

  it('debounces a slider drag 150ms rather than sending on every tick', () => {
    vi.useFakeTimers();
    try {
      render(<FogLookPanel />);
      const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
      const wind = screen.getByTestId('fog-look-wind');
      fireEvent.change(wind, { target: { value: '5' } });
      fireEvent.change(wind, { target: { value: '6' } });
      expect(sendCommand).not.toHaveBeenCalled();
      vi.advanceTimersByTime(149);
      expect(sendCommand).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      // Only the trailing value — the debounce coalesces the drag into one command.
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith('fog', 'set-fog-look', { look: { wind: 6 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('accumulates two dials touched within the debounce window into one merged command, not two racing ones', () => {
    vi.useFakeTimers();
    try {
      render(<FogLookPanel />);
      const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
      fireEvent.change(screen.getByTestId('fog-look-wind'), { target: { value: '5' } });
      vi.advanceTimersByTime(50);
      fireEvent.change(screen.getByTestId('fog-look-veil'), { target: { value: '0.2' } });
      vi.advanceTimersByTime(150);
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith('fog', 'set-fog-look', { look: { wind: 5, veil: 0.2 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes an outstanding debounced dial into an immediate toggle, so one merged command carries both fields', () => {
    vi.useFakeTimers();
    try {
      render(<FogLookPanel />);
      const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
      fireEvent.change(screen.getByTestId('fog-look-wind'), { target: { value: '5' } });
      fireEvent.click(screen.getByTestId('fog-look-heavy'));
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith('fog', 'set-fog-look', { look: { wind: 5, heavy: true } });
      // The flushed debounce timer must not also fire a stale second command later.
      vi.advanceTimersByTime(150);
      expect(sendCommand).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the layers collapsed behind a disclosure until it is opened', () => {
    render(<FogLookPanel />);
    expect(screen.getByTestId('fog-look-layers-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('fog-look-layer-0-strength')).toBeNull();

    fireEvent.click(screen.getByTestId('fog-look-layers-toggle'));
    expect(screen.getByTestId('fog-look-layers-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('fog-look-layer-0-strength')).not.toBeNull();

    // Leave it collapsed again — later tests in this file must not inherit an open disclosure
    // from the module-level "remember for the session" flag this control uses.
    fireEvent.click(screen.getByTestId('fog-look-layers-toggle'));
  });

  it('patches one layer field by resending the whole 3-layer array, the wire’s own contract', () => {
    vi.useFakeTimers();
    try {
      render(<FogLookPanel />);
      fireEvent.click(screen.getByTestId('fog-look-layers-toggle'));
      const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
      fireEvent.change(screen.getByTestId('fog-look-layer-0-strength'), { target: { value: '0.8' } });
      vi.advanceTimersByTime(150);
      const [, , payload] = sendCommand.mock.calls[0];
      const layers = (payload as { look: { layers: unknown[] } }).look.layers;
      expect(layers).toHaveLength(3);
      expect((layers[0] as { strength: number }).strength).toBe(0.8);
      // The untouched layers ride along unchanged, off the effective (DEFAULT_FOG_LOOK) look.
      expect(layers[1]).toEqual(DEFAULT_FOG_LOOK.layers[1]);
    } finally {
      vi.useRealTimers();
      // Collapse it again — the "open" flag is remembered at module scope for the real DM's
      // session, which also means it must not leak into a later test in this file.
      fireEvent.click(screen.getByTestId('fog-look-layers-toggle'));
    }
  });

  it('offers "Use the map\'s default" only once the DM has an override, and it clears with a null look', () => {
    render(<FogLookPanel />);
    expect(screen.queryByTestId('fog-look-reset')).toBeNull();

    cleanup();
    useSessionStore.setState({ session: session('sc-1', { fog: fogState({ wind: 9 }) }) });
    render(<FogLookPanel />);
    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    expect(screen.getByTestId('fog-look-reset')).not.toBeNull();
    fireEvent.click(screen.getByTestId('fog-look-reset'));
    expect(sendCommand).toHaveBeenCalledWith('fog', 'set-fog-look', { look: null });
  });
});

afterEach(() => {
  cleanup();
});
