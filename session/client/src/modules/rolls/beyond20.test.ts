import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDetectedSheet } from '../../session/detectedSheet';
import { useSessionStore } from '../../session/store';
import { translateRenderedRoll } from './beyond20';
import {
  ATTACK_ROLL,
  CHAT_MESSAGE,
  DAMAGE_ROLL,
  HIDDEN_NAMES_EMPTY_ROLL,
  HIDDEN_NAMES_ROLL,
  MALFORMED,
  NAT20_ROLL,
  OBJECT_CHARACTER_ROLL,
  OVERLONG_ROLL,
  SKILL_CHECK_ADVANTAGE,
  UPDATE_CONDITIONS_DETAIL,
  UPDATE_HP_DETAIL,
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
      description: 'Melee Weapon Attack',
      total: 24,
      visibility: 'public',
    });
  });

  it('takes the kept d20 on an advantage roll, not the discarded one, and marks the formula', () => {
    const post = translateRenderedRoll(SKILL_CHECK_ADVANTAGE);
    expect(post).toMatchObject({
      total: 27,
      title: 'Stealth Check',
      formula: '1d20 + 9 (adv)',
      breakdown: '12 ✗ / 27',
    });
  });

  it('marks a whispered roll private', () => {
    expect(translateRenderedRoll(WHISPER_ROLL)).toMatchObject({ visibility: 'private', total: 4 });
  });

  it('treats hide-names (whisper 3) as public', () => {
    expect(translateRenderedRoll(HIDDEN_NAMES_ROLL)).toMatchObject({ visibility: 'public' });
  });

  it('never leaks the real name past an empty hide-names replacement (HIGH)', () => {
    // `hidden-monster-replacement` can be set to "" — cap() treats that as absent, so a
    // naive fallback would read the uncensored `request.name` / `request.character` instead.
    const post = translateRenderedRoll(HIDDEN_NAMES_EMPTY_ROLL);
    expect(post?.title).toBeUndefined();
    expect(post?.characterName).toBeUndefined();
  });

  it('falls back to the damage roll when there is no attack roll, and folds roll_info in', () => {
    expect(translateRenderedRoll(DAMAGE_ROLL)).toMatchObject({
      formula: '8d6',
      total: 31,
      breakdown: 'Damage 31, Critical Damage 58 · Save DC: 15',
    });
  });

  it('caps every string before it leaves the tab', () => {
    const post = translateRenderedRoll(OVERLONG_ROLL);
    expect(post?.characterName).toHaveLength(60);
    expect(post?.title).toHaveLength(100);
    expect(post?.formula).toHaveLength(100);
    expect(post?.breakdown?.length).toBeLessThanOrEqual(200);
    expect(post?.description).toHaveLength(2000);
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

  it('accepts character as a string (the live shape)', () => {
    expect(translateRenderedRoll(ATTACK_ROLL)?.characterName).toBe('Thalia Brightwood');
  });

  it('accepts character as an object (the docs shape)', () => {
    expect(translateRenderedRoll(OBJECT_CHARACTER_ROLL)?.characterName).toBe('Grum the Unwise');
  });

  it('falls back to request.character.name when the top-level character is missing', () => {
    const post = translateRenderedRoll([
      {
        title: 'Perception',
        request: { character: { name: 'Fallback Name' } },
        attack_rolls: [{ formula: '1d20 + 3', total: 14, discarded: false }],
      },
    ]);
    expect(post?.characterName).toBe('Fallback Name');
  });

  it('reads total_damages Roll objects into the breakdown (regression: bug 2)', () => {
    // total_damages values are rolled Roll JSON objects, not strings — this is the fixture
    // that would have produced an empty breakdown before the fix.
    expect(translateRenderedRoll(ATTACK_ROLL)?.breakdown).toBe('Damage 9');
  });

  it('marks a natural 20 in the breakdown', () => {
    expect(translateRenderedRoll(NAT20_ROLL)?.breakdown).toBe('nat 20!');
  });

  it('suppresses total for a DOUBLE roll (two non-discarded d20s, no single "kept" one)', () => {
    const post = translateRenderedRoll([
      {
        title: 'Double Stealth Check',
        attack_rolls: [
          { formula: '1d20 + 9', total: 15, discarded: false },
          { formula: '1d20 + 9', total: 21, discarded: false },
        ],
      },
    ]);
    expect(post?.total).toBeUndefined();
    expect(post?.breakdown).toBe('15 / 21');
  });

  it('reads a bare numeric total_damages value', () => {
    const post = translateRenderedRoll([{ title: 'Numeric damage', total_damages: { Damage: 12 } }]);
    expect(post?.breakdown).toBe('Damage 12');
  });

  it('produces text (and posts, not null) for a chat-message roll', () => {
    const post = translateRenderedRoll(CHAT_MESSAGE);
    expect(post).not.toBeNull();
    expect(post?.text).toBe('The goblin flees!');
  });

  it('caps an overlong chat-message text instead of sending it uncapped', () => {
    const post = translateRenderedRoll([
      { request: { action: 'roll', type: 'chat-message', name: '', message: 'M'.repeat(400) } },
    ]);
    expect(post?.text).toHaveLength(200);
  });

  it('assembles description from source, attributes and description, newline-joined', () => {
    const post = translateRenderedRoll([
      {
        title: 'Fireball',
        source: 'Evocation Cantrip (Cast at 3rd Level)',
        attributes: { Range: '150 feet', 'Area of Effect': '20-foot radius' },
        description: 'A bright streak flashes...',
        attack_rolls: [{ formula: '1d20', total: 10, discarded: false }],
      },
    ]);
    expect(post?.description).toBe(
      'Evocation Cantrip (Cast at 3rd Level)\nRange: 150 feet\nArea of Effect: 20-foot radius\nA bright streak flashes...',
    );
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

  it('sends rolls:post for a Beyond20_UpdateHP event', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    document.dispatchEvent(new CustomEvent('Beyond20_UpdateHP', { detail: UPDATE_HP_DETAIL }));
    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'dndbeyond',
      characterName: 'Thalia Brightwood',
      text: 'HP 24/38 (+5 temp)',
      visibility: 'private',
    });
  });

  it('still posts an absurdly long HP name capped, not rejected', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateHP', { detail: [{}, 'N'.repeat(400), 24, 38, 5] }),
    );
    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'dndbeyond',
      characterName: 'N'.repeat(60),
      text: 'HP 24/38 (+5 temp)',
      visibility: 'private',
    });
  });

  it('ignores a Beyond20_UpdateHP event missing a name or a numeric hp', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateHP', { detail: [{}, undefined, 24, 38, 5] }),
    );
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateHP', { detail: [{}, 'Thalia Brightwood', 'lots', 38, 5] }),
    );
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('sends rolls:post for a Beyond20_UpdateConditions event', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateConditions', { detail: UPDATE_CONDITIONS_DETAIL }),
    );
    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'dndbeyond',
      characterName: 'Thalia Brightwood',
      text: 'Conditions: Poisoned, Prone · exhaustion 1',
      visibility: 'private',
    });
  });

  it('drops an all-empty Beyond20_UpdateConditions update instead of posting "none"', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateConditions', {
        detail: [{}, 'Thalia Brightwood', [], 0],
      }),
    );
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('filters out empty-string conditions instead of rendering blank entries', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    // A lone '' must be treated the same as an empty list — it should not pass the
    // all-empty guard and post a bare "Conditions: " line.
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateConditions', { detail: [{}, 'Thalia Brightwood', [''], 0] }),
    );
    expect(sendCommand).not.toHaveBeenCalled();

    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateConditions', {
        detail: [{}, 'Thalia Brightwood', ['', 'Poisoned'], 0],
      }),
    );
    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'dndbeyond',
      characterName: 'Thalia Brightwood',
      text: 'Conditions: Poisoned',
      visibility: 'private',
    });
  });

  it('caps an overlong conditions line instead of dropping the whole update', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand });

    const manyConditions = Array.from({ length: 40 }, (_, i) => `Condition${i}`);
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateConditions', {
        detail: [{}, 'Thalia Brightwood', manyConditions, 0],
      }),
    );
    expect(sendCommand).toHaveBeenCalled();
    const posted = sendCommand.mock.calls[0][2] as { text: string };
    expect(posted.text).toHaveLength(200);
  });
});

describe('Beyond20 sheet detection (link-a-character-sheet)', () => {
  beforeEach(() => {
    useDetectedSheet.setState({ sheet: null, dismissed: new Set() });
    useSessionStore.setState({ sendCommand: vi.fn() });
  });

  it('stashes a Character-type payload off a rendered-roll (request.character)', () => {
    document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: ATTACK_ROLL }));
    expect(useDetectedSheet.getState().sheet).toEqual({
      name: 'Thalia Brightwood',
      id: '12345',
      url: 'https://…',
    });
  });

  it('never stashes a Monster-type character — the DM rolling a stat block must not be offered a bind', () => {
    document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: HIDDEN_NAMES_ROLL }));
    expect(useDetectedSheet.getState().sheet).toBeNull();
  });

  it('stashes a Character-type payload off Beyond20_UpdateHP (detail[0].character)', () => {
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateHP', {
        detail: [
          {
            character: {
              name: 'Thalia Brightwood',
              type: 'Character',
              id: 'ddb-1',
              url: 'https://www.dndbeyond.com/characters/1',
            },
          },
          'Thalia Brightwood',
          24,
          38,
          5,
        ],
      }),
    );
    expect(useDetectedSheet.getState().sheet).toEqual({
      name: 'Thalia Brightwood',
      id: 'ddb-1',
      url: 'https://www.dndbeyond.com/characters/1',
    });
  });

  it('never stashes a Monster-type character off Beyond20_UpdateHP', () => {
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateHP', {
        detail: [{ character: { name: 'Owlbear', type: 'Monster' } }, 'Owlbear', 40, 40, 0],
      }),
    );
    expect(useDetectedSheet.getState().sheet).toBeNull();
  });

  it('stashes off Beyond20_UpdateConditions the same way', () => {
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateConditions', {
        detail: [
          { character: { name: 'Thalia Brightwood', type: 'Character' } },
          'Thalia Brightwood',
          ['Poisoned'],
          0,
        ],
      }),
    );
    expect(useDetectedSheet.getState().sheet).toEqual({ name: 'Thalia Brightwood' });
  });

  it('the latest detection wins — a second sheet replaces the first', () => {
    document.dispatchEvent(new CustomEvent('Beyond20_RenderedRoll', { detail: ATTACK_ROLL }));
    document.dispatchEvent(
      new CustomEvent('Beyond20_UpdateHP', {
        detail: [{ character: { name: 'Grum the Unwise', type: 'Character' } }, 'Grum', 10, 10, 0],
      }),
    );
    expect(useDetectedSheet.getState().sheet?.name).toBe('Grum the Unwise');
  });

  it('does not stash off a hide-names (whisper 3) roll, even for a PC character', () => {
    // request.character is the uncensored object (§6/§13) — a hidden roll must not let that
    // leak into shared state through "Link", so this checks the whisper===3 guard on its own,
    // separately from the Monster-type guard above.
    document.dispatchEvent(
      new CustomEvent('Beyond20_RenderedRoll', {
        detail: [
          {
            action: 'rendered-roll',
            request: {
              action: 'roll',
              type: 'attack',
              character: { name: 'Thalia Brightwood', type: 'Character', id: '12345' },
            },
            title: '???',
            character: '???',
            whisper: 3,
            attack_rolls: [{ formula: '1d20 + 7', total: 24, discarded: false }],
            total_damages: {},
          },
        ],
      }),
    );
    expect(useDetectedSheet.getState().sheet).toBeNull();
  });

  it('neither stashes nor throws on a junk character value (string, null, array)', () => {
    for (const junk of ['nope', null, ['nope']]) {
      expect(() =>
        document.dispatchEvent(
          new CustomEvent('Beyond20_UpdateHP', { detail: [{ character: junk }, 'Someone', 10, 10, 0] }),
        ),
      ).not.toThrow();
      expect(useDetectedSheet.getState().sheet).toBeNull();
    }
  });
});
