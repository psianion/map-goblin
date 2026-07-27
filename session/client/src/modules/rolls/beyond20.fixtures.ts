/**
 * Beyond20 `rendered-roll` requests, shaped from the extension's published DOM/Message API
 * (docs/api.md in kakaroto/Beyond20): `Beyond20_RenderedRoll` is dispatched on `document`
 * with `detail: [request]`, where the request carries `title`, `character`, `whisper`
 * (0 no · 1 whisper · 2 query · 3 hide-names), `attack_rolls: Roll[]` and
 * `total_damages: {label: total}`.
 *
 * ponytail: hand-built from the spec, not captured off a live sheet — the S2 gate does the
 * real-DDB click with the user driving. If a captured payload disagrees, replace a fixture
 * here and the translation test tells you what moved.
 */

/** Advantage: two d20s, the loser flagged `discarded`. */
export const ATTACK_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'attack', name: 'Longsword', advantage: 0, whisper: 0 },
    title: 'Longsword: Attack',
    html: '<div class="beyond20-roll">…</div>',
    character: { name: 'Thalia Brightwood', type: 'Character', id: '12345', url: 'https://…' },
    whisper: 0,
    play_sound: true,
    source: 'Longsword',
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
    total_damages: { Damage: '9' },
  },
]

/** Skill check rolled with advantage — the discarded d20 must not become the total. */
export const SKILL_CHECK_ADVANTAGE = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'skill', name: 'Stealth', advantage: 1, whisper: 0 },
    title: 'Stealth Check',
    character: { name: 'Thalia Brightwood', type: 'Character' },
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
    character: { name: 'Grum the Unwise', type: 'Character' },
    whisper: 1,
    play_sound: true,
    attack_rolls: [{ formula: '1d20 - 1', total: 4, type: 'saving-throw', discarded: false }],
    roll_info: [],
    damage_rolls: [],
    total_damages: {},
  },
]

/** Damage-only: no `attack_rolls` at all, the number lives in `total_damages`. */
export const DAMAGE_ROLL = [
  {
    action: 'rendered-roll',
    request: { action: 'roll', type: 'attack', name: 'Fireball', whisper: 0 },
    title: 'Fireball: Damage',
    character: { name: 'Thalia Brightwood', type: 'Character' },
    whisper: 0,
    play_sound: true,
    attack_rolls: [],
    roll_info: [['Save DC', '15']],
    damage_rolls: [['Fire', { formula: '8d6', total: 31, type: 'damage' }, {}]],
    total_damages: { Damage: '31', 'Critical Damage': '58' },
  },
]

/** `whisper: 3` = "don't whisper, hide the names" — still a public line for us. */
export const HIDDEN_NAMES_ROLL = [
  {
    action: 'rendered-roll',
    title: 'Attack',
    character: { name: 'Bandit Captain', type: 'Monster' },
    whisper: 3,
    attack_rolls: [{ formula: '1d20 + 5', total: 18, discarded: false }],
    total_damages: {},
  },
]

/** Character names on DDB can be absurd; the cap is not optional. */
export const OVERLONG_ROLL = [
  {
    action: 'rendered-roll',
    title: 'T'.repeat(400),
    character: { name: 'N'.repeat(400) },
    whisper: 0,
    attack_rolls: [{ formula: 'F'.repeat(400), total: 3, discarded: false }],
    total_damages: { ['D'.repeat(400)]: 'X'.repeat(400) },
  },
]

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
