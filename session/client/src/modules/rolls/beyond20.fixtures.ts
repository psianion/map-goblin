/**
 * Beyond20 `rendered-roll` requests, shaped to match live source behavior, not just the
 * published DOM/Message API doc (docs/api.md in kakaroto/Beyond20) — see
 * docs/beyond20-vtt-capabilities.md for the two divergences that matter here: `character` is
 * a plain string (the name, pre-censored for hide-names), and `total_damages` values are
 * rolled Roll JSON objects, not strings. `Beyond20_RenderedRoll` is dispatched on `document`
 * with `detail: [request]`; the request carries `title`, `character`, `whisper`
 * (0 no · 1 whisper · 2 query · 3 hide-names), `attack_rolls: Roll[]` and
 * `total_damages: {label: Roll}`.
 *
 * ponytail: hand-built from the spec, not captured off a live sheet — the S2 gate does the
 * real-DDB click with the user driving. If a captured payload disagrees, replace a fixture
 * here and the translation test tells you what moved.
 */

/** Advantage: two d20s, the loser flagged `discarded`. */
export const ATTACK_ROLL = [
  {
    action: 'rendered-roll',
    request: {
      action: 'roll',
      type: 'attack',
      name: 'Longsword',
      advantage: 0,
      whisper: 0,
      // The full character object rides in `request.character` — this exercises that path
      // alongside the top-level string below.
      character: { name: 'Thalia Brightwood', type: 'Character', id: '12345', url: 'https://…' },
    },
    title: 'Longsword: Attack',
    html: '<div class="beyond20-roll">…</div>',
    character: 'Thalia Brightwood',
    whisper: 0,
    play_sound: true,
    // Attacks don't populate `source` on the wire (only traits/items/spells do) — '' is the
    // real shape.
    source: '',
    attributes: {},
    description: 'Melee Weapon Attack',
    attack_rolls: [
      {
        formula: '1d20 + 7',
        total: 24,
        type: 'to-hit',
        discarded: false,
        'critical-success': false,
        'critical-failure': false,
        parts: [{ formula: '1d20', amount: 1, faces: 20, total: 17, rolls: [{ roll: 17 }] }, '+', 7],
      },
    ],
    roll_info: [],
    damage_rolls: [['Slashing', { formula: '1d8 + 4', total: 9, type: 'damage' }, {}]],
    total_damages: { Damage: { formula: '1d8 + 4', total: 9, type: 'damage' } },
  },
]

/** Skill check rolled with advantage (RollType.ADVANTAGE = 3) — the discarded d20 must not
 *  become the total, and the formula picks up the ' (adv)' marker. */
export const SKILL_CHECK_ADVANTAGE = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'skill', name: 'Stealth', advantage: 3, whisper: 0 },
    title: 'Stealth Check',
    character: 'Thalia Brightwood',
    whisper: 0,
    play_sound: true,
    attack_rolls: [
      { formula: '1d20 + 9', total: 12, type: 'skill', discarded: true },
      { formula: '1d20 + 9', total: 27, type: 'skill', discarded: false },
    ],
    roll_info: [],
    damage_rolls: [],
    total_damages: {},
  },
]

/** `whisper: 1` — the DM asked for it quietly, so it must land as `visibility: 'private'`. */
export const WHISPER_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'saving-throw', name: 'Wisdom', whisper: 1 },
    title: 'Wisdom Saving Throw',
    character: 'Grum the Unwise',
    whisper: 1,
    play_sound: true,
    attack_rolls: [{ formula: '1d20 - 1', total: 4, type: 'saving-throw', discarded: false }],
    roll_info: [],
    damage_rolls: [],
    total_damages: {},
  },
]

/** Damage-only: no `attack_rolls` at all, the numbers live in `total_damages` — and
 *  `roll_info` ("Save DC: 15") asserts that pairs land in the breakdown. */
export const DAMAGE_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'attack', name: 'Fireball', whisper: 0 },
    title: 'Fireball: Damage',
    character: 'Thalia Brightwood',
    whisper: 0,
    play_sound: true,
    attack_rolls: [],
    roll_info: [['Save DC', '15']],
    damage_rolls: [['Fire', { formula: '8d6', total: 31, type: 'damage' }, {}]],
    total_damages: {
      Damage: { formula: '8d6', total: 31 },
      'Critical Damage': { formula: '8d6+8d6', total: 58 },
    },
  },
]

/** `whisper: 3` = "don't whisper, hide the names" — still a public line for us. Hide-names
 *  censors `title` and the top-level `character` string to "???", but never the character
 *  *object* riding in `request.character` (§6/§13 of the capability doc). */
export const HIDDEN_NAMES_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'attack', character: { name: 'Bandit Captain', type: 'Monster' } },
    title: 'Attack',
    character: '???',
    whisper: 3,
    attack_rolls: [{ formula: '1d20 + 5', total: 18, discarded: false }],
    total_damages: {},
  },
]

/** `hidden-monster-replacement` is free text and DMs can set it to "" — `title`/`character`
 *  are then empty, and the real name must NOT leak from `request.name` / `request.character`
 *  (never censored, §6/§13) as a fallback. */
export const HIDDEN_NAMES_EMPTY_ROLL = [
  {
    action: 'rendered-roll',
    request: {
      action: 'roll',
      type: 'attack',
      name: 'Bandit Captain',
      character: { name: 'Bandit Captain' },
    },
    title: '',
    character: '',
    whisper: 3,
    attack_rolls: [{ formula: '1d20 + 5', total: 18, discarded: false }],
    total_damages: {},
  },
]

/** docs/api.md documents `character` as an object at top level — a synthetic sender (or the
 *  e2e roll) may still send that shape, so the bridge has to accept it too. */
export const OBJECT_CHARACTER_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'ability', name: 'Strength Check', whisper: 0 },
    title: 'Strength Check',
    character: { name: 'Grum the Unwise', type: 'Character' },
    whisper: 0,
    attack_rolls: [{ formula: '1d20 + 2', total: 15, type: 'ability-check', discarded: false }],
    roll_info: [],
    damage_rolls: [],
    total_damages: {},
  },
]

/** A natural 20 — the kept roll's `critical-success` flag becomes a breakdown marker. */
export const NAT20_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'attack', name: 'Longsword', advantage: 0, whisper: 0 },
    title: 'Longsword: Attack',
    character: 'Thalia Brightwood',
    whisper: 0,
    attack_rolls: [
      {
        formula: '1d20 + 7',
        total: 27,
        type: 'to-hit',
        discarded: false,
        'critical-success': true,
        'critical-failure': false,
      },
    ],
    roll_info: [],
    damage_rolls: [],
    total_damages: {},
  },
]

/** `type: "chat-message"` — no `attack_rolls`, no total; this is also how notes-to-vtt
 *  [[before]]/[[after]] blocks arrive. `request.message` is the whole payload. */
export const CHAT_MESSAGE = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'chat-message', name: '', message: 'The goblin flees!' },
    title: '',
    character: 'Thalia Brightwood',
    whisper: 0,
    attack_rolls: [],
    roll_info: [],
    damage_rolls: [],
    total_damages: {},
  },
]

/** Character names — and item descriptions — on DDB can be absurd; the caps are not
 *  optional. */
export const OVERLONG_ROLL = [
  {
    action: 'rendered-roll',
    title: 'T'.repeat(400),
    character: 'N'.repeat(400),
    description: 'D'.repeat(3000),
    whisper: 0,
    attack_rolls: [{ formula: 'F'.repeat(400), total: 3, discarded: false }],
    total_damages: { ['D'.repeat(400)]: 'X'.repeat(400) },
  },
]

/** `Beyond20_UpdateHP` detail: `[request, name, hp, maxHp, tempHp]`. */
export const UPDATE_HP_DETAIL = [{}, 'Thalia Brightwood', 24, 38, 5]

/** `Beyond20_UpdateConditions` detail: `[request, name, conditions, exhaustion]`. */
export const UPDATE_CONDITIONS_DETAIL = [{}, 'Thalia Brightwood', ['Poisoned', 'Prone'], 1]

/** Everything that must be dropped without throwing. */
export const MALFORMED = [
  undefined,
  null,
  [],
  [null],
  ['just a string'],
  [42],
  {},
  [{ action: 'hp-update', hp: 12 }], // right event bus, wrong message
  [{ action: 'rendered-roll' }], // nothing displayable in it
  [{ action: 'rendered-roll', attack_rolls: 'not an array', total_damages: 7 }],
  [{ action: 'rendered-roll', title: 42, character: 'nope' }],
  [{ action: 'rendered-roll', attack_rolls: [{ total: Number.NaN }] }],
]
