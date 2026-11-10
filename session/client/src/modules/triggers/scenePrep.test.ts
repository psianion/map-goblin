import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSessionStore } from '../../session/store';
import { resetScenePrep, useScenePrep } from './scenePrep';

const answers: ((v: unknown) => void)[] = [];
vi.mock('../../session/auth', () => ({
  getScenePrep: () => new Promise((resolve) => answers.push(resolve)),
}));

const prepOf = (name: string) => ({ prep: { triggers: [{ id: 't1', name }] }, resolved: [] });

beforeEach(() => {
  answers.length = 0;
  resetScenePrep();
  useSessionStore.setState({ token: 'tok', prepRevision: 0, session: { activeSceneId: 'a' } as never });
});

describe('useScenePrep', () => {
  it('keeps the last list while a new revision of the same scene loads', async () => {
    const { result } = renderHook(() => useScenePrep());
    await act(async () => answers[0]!(prepOf('Bell')));
    await waitFor(() => expect(result.current.prep?.triggers[0]?.name).toBe('Bell'));

    act(() => useSessionStore.setState({ prepRevision: 1 }));
    expect(result.current.prep?.triggers[0]?.name).toBe('Bell');

    await act(async () => answers[1]!(prepOf('Gong')));
    await waitFor(() => expect(result.current.prep?.triggers[0]?.name).toBe('Gong'));
  });

  it('shows nothing from another scene', async () => {
    const { result } = renderHook(() => useScenePrep());
    await act(async () => answers[0]!(prepOf('Bell')));
    await waitFor(() => expect(result.current.prep).not.toBeNull());
    act(() => useSessionStore.setState({ session: { activeSceneId: 'b' } as never }));
    expect(result.current.prep).toBeNull();
  });
});
