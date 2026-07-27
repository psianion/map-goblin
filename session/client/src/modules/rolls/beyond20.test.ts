import { describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../../session/store';
import { translateRenderedRoll } from './beyond20';
import {
  ATTACK_ROLL,
  DAMAGE_ROLL,
  HIDDEN_NAMES_ROLL,
  MALFORMED,
  OVERLONG_ROLL,
  SKILL_CHECK_ADVANTAGE,
  WHISPER_ROLL,
} from './beyond20.fixtures';

describe('Beyond20 → rolls:post translation', () => {
  it('reads an attack roll', () => {
    expect(translateRenderedRoll(ATTACK_ROLL)).toEqual({
      source: 'dndbeyond',
      characterName: 'Thalia Brightwood',
      title: 'Longsword: Attack',
      formula: '1d20 + 7',
      breakdown: 'Damage 9',
      total: 24,
      visibility: 'public',
    });
  });

  it('takes the kept d20 on an advantage roll, not the discarded one', () => {
    const post = translateRenderedRoll(SKILL_CHECK_ADVANTAGE);
    expect(post).toMatchObject({ total: 27, title: 'Stealth Check', breakdown: '12 ✗ / 27' });
  });

  it('marks a whispered roll private', () => {
    expect(translateRenderedRoll(WHISPER_ROLL)).toMatchObject({ visibility: 'private', total: 4 });
  });

  it('treats hide-names (whisper 3) as public', () => {
    expect(translateRenderedRoll(HIDDEN_NAMES_ROLL)).toMatchObject({ visibility: 'public' });
  });

  it('falls back to the damage roll when there is no attack roll', () => {
    expect(translateRenderedRoll(DAMAGE_ROLL)).toMatchObject({
      formula: '8d6',
      total: 31,
      breakdown: 'Damage 31, Critical Damage 58',
    });
  });

  it('caps every string before it leaves the tab', () => {
    const post = translateRenderedRoll(OVERLONG_ROLL);
    expect(post?.characterName).toHaveLength(60);
    expect(post?.title).toHaveLength(100);
    expect(post?.formula).toHaveLength(100);
    expect(post?.breakdown?.length).toBeLessThanOrEqual(200);
  });

  it('drops malformed detail silently', () => {
    for (const detail of MALFORMED) expect(translateRenderedRoll(detail)).toBeNull();
  });

  it('omits a non-numeric total instead of sending it', () => {
    const post = translateRenderedRoll([
      { title: 'Description only', attack_rolls: [{ formula: '1d20', total: 'seventeen' }] },
    ]);
    expect(post).toMatchObject({ title: 'Description only' });
    expect(post?.total).toBeUndefined();
  });
});

describe('Beyond20 listener', () => {
  it('sends rolls:post for an event dispatched on document', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    // Beyond20's own dispatch: `document`, non-bubbling. The listener is capture-phase.
    document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: ATTACK_ROLL }));
    expect(sendCommand).toHaveBeenCalledWith(
      'rolls',
      'post',
      expect.objectContaining({ source: 'dndbeyond', total: 24 }),
    );

    // Junk on the same bus never reaches the wire.
    sendCommand.mockClear();
    document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: [null] }));
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
