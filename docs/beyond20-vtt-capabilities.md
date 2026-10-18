# Beyond20 → VTT capability reference

What the Beyond20 browser extension can send to and receive from a VTT site, verified
against source at `github.com/kakaroto/Beyond20` master (fetched 2026-09-01). The
published `docs/api.md` was read as a map only; every shape below was checked against
the code. Divergences between the doc and live behavior are flagged inline with
**DOC-DIVERGENCE** — in each case the source behavior is what actually ships.

Our site is registered as a Beyond20 **custom domain**, so section 2 (DOM CustomEvents)
is the surface we actually integrate with. Everything else is documented so nothing is
missed when deciding what to surface.

Source files referenced:

- `docs/api.md` — the published API doc
- `src/common/roll_renderer.js` — builds every rendered-roll
- `src/common/settings.js` — all settings + enums
- `src/common/utils.js` — `sendCustomEvent`, `addCustomEventListener`, `forwardMessageToDOM`
- `src/common/dice.js` — Roll / DiceRoll `toJSON()`
- `src/common/roll-table.js` — roll tables
- `src/generic-site/content-script.js`, `src/generic-site/renderer.js` — custom-domain path
- `src/extension/background.js` — routing
- `src/dndbeyond/base/{base,character,monster,extras,utils,dice}.js` — sheet parsers, `sendRoll`
- `src/dndbeyond/content-scripts/{character,encounter,monster,vehicle,spell,item,feat,source}.js`

---

## 1. Architecture in one paragraph

D&D Beyond pages parse the sheet and send messages (`chrome.runtime.sendMessage`) with an
`action` field to the extension background. The background forwards five actions —
`roll`, `rendered-roll`, `hp-update`, `conditions-update`, `update-combat` — to every
registered VTT tab: Roll20 tabs, Foundry tabs, and **all** custom-domain tabs (the
`vtt-tab` campaign limit applies only to Roll20/Foundry; custom tabs always receive,
`background.js` `sendMessageToCustomSites` ignores the limit). A custom-domain tab is
registered when the generic-site content script is injected (user grants the origin via
the toolbar icon, or automatically once the origin permission exists) and it sends
`register-generic-tab`. The content script then translates each forwarded message into a
DOM `CustomEvent` on `document` — that is the entire surface a custom-domain page sees.
Exception: `vtt-tab` set to "D&D Beyond only" (`vtt: "dndbeyond"`) stops forwarding to
every VTT including custom domains.

---

## 2. DOM CustomEvents a custom-domain page receives

All events are dispatched on `document`, non-bubbling, name prefixed `Beyond20_`, with
`event.detail` = an **array of arguments** (Firefox: `cloneInto`-wrapped).
Source: `utils.js` `sendCustomEvent` / `forwardMessageToDOM`, `generic-site/content-script.js`.

| Event | `detail` array | When |
|---|---|---|
| `Beyond20_Loaded` | `[settings]` | Once, when the content script initializes in the tab. Signals "Beyond20 is here". |
| `Beyond20_NewSettings` | `[settings, extensionURL]` | Right after `Loaded`, and again on every global settings change (any tab). |
| `Beyond20_RenderedRoll` | `[renderedRollMessage]` | Every roll. See section 4 for the full shape. |
| `Beyond20_UpdateHP` | `[request, name, hp, maxHp, tempHp]` | On `hp-update`. `request.character` is the full character object; the four extras are convenience copies of `character.name`, `.hp`, `.["max-hp"]`, `.["temp-hp"]`. |
| `Beyond20_UpdateConditions` | `[request, name, conditions, exhaustion]` | On `conditions-update`. `conditions` is `string[]`, `exhaustion` a number. |
| `Beyond20_UpdateCombat` | `[request, combat, settings]` | On `update-combat` from the DDB encounter/combat tracker. `combat` is the combatant array (section 8). |

Notes:

- A `roll` message never reaches the page raw. The generic content script feeds it into
  its own `Beyond20RollRenderer` and the page receives the result as a
  `Beyond20_RenderedRoll` with `rendered: "fallback"`. So on a custom domain, **every**
  roll arrives as `RenderedRoll` — with digital dice off you get exactly one (the
  fallback), with digital dice on you get the DDB-rolled render (no `rendered` field).
- Fallback de-dup: `forwardMessageToDOM` holds a fallback render for 500 ms (hash of the
  original request) and cancels it if a real render for the same request lands in that
  window. Beyond20 de-dupes; the page should not drop `rendered === "fallback"` events.
- The raw-action events described in api.md (`Beyond20_roll`, `Beyond20_hp-update`, …)
  exist only **on D&D Beyond's own pages** (`sendRollRequestToDOM` emits both the raw
  action name and the mapped event). A custom domain never sees them.
- `settings` messages of type `"character"` are forwarded to the tab but the generic
  content script ignores them — character settings reach the page only inside
  `request.character.settings` on each roll.
- The content script also listens for `Beyond20_disconnect` and detaches its own
  listeners when received (used when a fresh copy injects). Don't dispatch it yourself.

### The `settings` object (in `Loaded` / `NewSettings` / `UpdateCombat`)

The full global settings dict. Keys that matter for interpreting payloads (defaults in
parentheses): `whisper-type` (0), `whisper-type-monsters` (1), `roll-type` (0),
`use-digital-dice` (true), `auto-roll-damage` (true), `critical-homebrew` (0),
`weapon-force-critical` (false), `update-hp` (true), `display-conditions` (true),
`sync-combat-tracker` (true), `initiative-tracker` (true), `initiative-tiebreaker`
(false), `components-display` ("all"), `component-prefix` ("Components: "),
`crit-prefix` ("Crit: "), `hidden-monster-replacement` ("???"),
`combat-unknown-monster-name` ("Unknown Creature"), `subst-vtt` (true),
`weapon-handedness` (false), `custom-domains` (string[] of URL patterns), `vtt-tab`,
`discord-channels`, `roll20-template`, `quick-rolls`, `hotkeys-bindings`. Section 10
covers which of these change payloads vs only change sender behavior.

---

## 3. The `roll` request (rides inside `rendered-roll.request`)

Built in `dndbeyond/base/utils.js` `sendRoll`. Common fields, always present:

| Field | Type | Notes |
|---|---|---|
| `action` | `"roll"` | |
| `type` | string | One of the 16 roll types below. |
| `character` | Beyond20Character | Full object — section 6. **This is where the character object lives in a rendered-roll.** |
| `roll` | string \| 0 | Fallback dice formula (cleaned). `0` for display-only types (trait, item, spell-card, chat-message). For `avatar` it is the image URL. |
| `advantage` | RollType number | 0–7 on the wire (8/9 are internal and resolved before sending). Section 9. |
| `whisper` | WhisperType number | 0/1/3 on the wire (2 = query is resolved before sending). Section 9. |

Optional fields that can appear on any roll (mostly undocumented in api.md):

| Field | Type | When present | Gated by |
|---|---|---|---|
| `preview` | string (URL) | Character-sheet rolls when the side panel has a preview image (weapon/spell/item art). | — |
| `d20` | string | Non-standard d20, e.g. `"1d20min10"` (Reliable Talent), `"1d20ro<=1"` (Halfling Lucky). | character features + `halfling-lucky` setting |
| `effects` | string[] | Effect names applied to the roll: "Bless", "Bane", "Exhaustion (N)", "Enlarge", "Reduce", "Reckless Attack", class-feature effects. Rendered into `roll_info`. **DOC-DIVERGENCE (minor):** documented per-type, but injected centrally so it can appear on any d20 roll type. | `effects-*` character settings |
| `advantage-query` | string | Reason text shown when the user is queried for advantage (sheet adv/disadv icons). Not in api.md. | `roll-type` = QUERY |
| `sendMessage` | true | Present when digital dice made the roll on DDB's side (tells the renderer to emit a rendered-roll). Not in api.md. | `use-digital-dice` |
| `original-whisper` | WhisperType | Added when a DDB-side render error forced whisper to NO; holds the original value. Not in api.md. | error path only |

### Per-type additional fields (verified against source; api.md is accurate unless flagged)

- **`avatar`** — `name` (image title). `roll` = image URL, `character.avatar` = URL.
- **`initiative`** — `initiative` (modifier string; becomes a two-decimal string like
  `"+3.14"` when `initiative-tiebreaker` is on — DEX score as decimal), `effects?`.
- **`ability`** — `name`, `ability` (STR/DEX/…), `modifier`, `ability-score?`, `d20?`, `effects?`.
- **`saving-throw`** — `name`, `ability`, `modifier`, `proficiency?` ("None" / "Proficient" / "Half Proficiency" / "Expertise"), `d20?`, `effects?`.
- **`skill`** — `skill` (name), `ability`, `modifier`, `proficiency?`, `d20?`, `effects?`.
- **`trait`** — `name`, `description`, `source?`, `source-type?`, `item-type?`. `roll` = 0.
- **`item`** — `name`, `description`, `item-type?`, `item-customizations?` (string[]), `quantity?` (int), `tags?` (string[]). `roll` = 0.
- **`attack`** — `name`, `description`, `to-hit?` (string, absent for save-only attacks), `damages` (string[]), `damage-types` (string[], same length), `critical-damages` (string[]), `critical-damage-types` (string[]), `rollAttack` (bool), `rollDamage` (bool), `rollCritical?` (bool), `critical-limit?` (number; also set to 1 with `rollCritical` by `weapon-force-critical` / force-crit hotkey; `custom-critical-limit` character setting overrides and appends "(CRITn)" to the name), `d20?`, `attack-source` ("item"/"action"/"spell"), `attack-type` ("Melee"/"Ranged"), `reach?`, `range?`, `save-ability?`, `save-dc?`, `proficient?` (bool), `properties?` (string[] weapon properties), `mastery?` (string, 2024 weapon mastery), `is_versatile?` (bool — **not in api.md**; marks damages[1] as the 2-handed roll), `effects?`, `cunning-strike-effects?` (string, comma-joined — **not in api.md**), `brutal?`-related extras fold into damages.
- **`spell-card`** — `name`, `description`, `level-school`, `cast-at?` ("3rd"…), `range`, `concentration` (bool), `ritual` (bool), `duration`, `casting-time`, `components` (string like "V, S, M (…)"), `aoe?`, `aoe-shape?`. `roll` = 0. HIDE_NAMES whisper is downgraded to NO for spell cards so the card shows.
- **`spell-attack`** — union of `attack` + `spell-card` fields.
- **`roll-table`** — `name`, `formula`, `table` (`{columnName: {rollRange: resultText}}`, ranges like `"1-3"`; `"00"` = 100 on d100).
- **`hit-dice`** — `class`, `multiclass` (bool), `hit-dice` (formula), `effects?`.
- **`death-save`** — `modifier?`, `effects?`.
- **`chat-message`** — `name` (title, often empty), `message` (the text). `roll` = 0. This is also the carrier for the **notes-to-vtt** feature: `[[before]]…[[/before]]`, `[[after]]…[[/after]]`, `[[replace]]…[[/replace]]` blocks in an item/action/spell's Notes or Description arrive as separate `chat-message` rolls before/after/instead-of the main roll (no setting gates it; `notes-to-vtt` in settings is only the info text).
- **`digital-dice`** — `name`. Only ever appears as `rendered-roll.request` when the user rolls loose dice in DDB's dice tray. `roll` = the first formula.
- **`custom`** — `name`, `description?`, `modifier?` (the formula; falls back to `roll`). Sent for inline `[dice]` formulas in text blocks, monster HP-formula clicks, and the DDB dice-toolbar button when digital dice are off. `advantage` is forced to NORMAL.

---

## 4. `rendered-roll` — the message that matters on a custom domain

Built by `roll_renderer.js` `postDescription` → `GenericDisplayer.postHTML`
(generic-site/renderer.js) or, for digital dice, `DNDBDisplayer.sendMessage(ToDOM)`
(dndbeyond/base/dice.js). The custom-domain page receives it as
`Beyond20_RenderedRoll` `detail[0]`.

| Field | Type | When present | Notes |
|---|---|---|---|
| `action` | `"rendered-roll"` | always | |
| `rendered` | `"fallback"` | only on the local (generic-site) render | Absent on DDB digital-dice renders. Do not filter fallbacks out — on a custom domain with digital dice off, fallback is the only render you get. |
| `request` | roll request | always | The original request, section 3. **The full character object is `request.character`.** |
| `title` | string | always | E.g. `"Athletics (+5)"`, `"Longsword"`, `"Death Saving Throw"`, `"Hit Dice(Fighter)"`, `"name (formula)"` for digital dice. Replaced by `hidden-monster-replacement` ("???") when whisper = HIDE_NAMES. |
| `html` | string | always | Fully rendered roll block (Beyond20 CSS classes). For `chat-message` it is the raw message text; for `avatar` an `<img>` tag. |
| `character` | **string** | always | **DOC-DIVERGENCE (the big one):** api.md says Beyond20Character; live it is `request.character.name` (roll_renderer.js L495/L519/L537) or the `hidden-monster-replacement` string when whisper = HIDE_NAMES. The object rides in `request.character`. |
| `whisper` | WhisperType | always | |
| `play_sound` | bool | always | True iff actual dice were rolled (false for cards/messages). |
| `source` | string | always ('' when none) | Trait source ("Class: Fighter"), spell level-school ("Evocation Cantrip (Cast at 3rd Level)"), item type. |
| `attributes` | object | always ({} when none) | Key→string display attributes: spell "Casting Time", "Duration", "Components", "Range", "Area of Effect", "AoE Shape", "Ritual", "Concentration"; attack "Range"/"AoE". |
| `description` | string \| null | display types + attacks | Item/spell/trait description text. Nulled when whisper = HIDE_NAMES. |
| `attack_rolls` | Roll[] (JSON) | d20-type rolls | Misnamed: the *primary* rolls — d20s for checks/saves/initiative/death-saves/to-hit, the formula roll for custom/hit-dice/roll-table, all digital-dice rolls. 2 entries for advantage/disadvantage (loser `discarded: true`), 3 for thrice/super. Empty for cards/messages/damage-only. |
| `roll_info` | [string, string][] | when extras exist | Name/value pairs: `["Effects", "Bless, Bane"]`, `["Mastery", "Vex"]`, `["Save", "DEX DC 15"]`, `["Cunning Strike Effects", …]`, `["Range", …]`, `["Cast at", "3rd Level"]`, `["Components"/"Materials", …]` (per `components-display`), and **roll-table results** as `[columnName, resultText]`. |
| `damage_rolls` | [string, Roll\|string, number][] | attacks/spells with damage | `[label, roll, flags]`. Label = damage type + " Damage"/" Critical Damage" or "Healing"; `roll` can be a plain string for message-style entries ("Twice the Necrotic damage"). Flags: section 7. |
| `total_damages` | object | when ≥2 damages of a kind | **DOC-DIVERGENCE:** api.md says values are strings; live each value is a rolled **Roll JSON object** (the formula string is re-rolled as a grouping roll before serializing — roll_renderer.js L470-487, L515). Keys: "Damage", "Critical Damage", "1-Handed Damage"/"2-Handed Damage" (+Critical variants), "Full HP Damage"/"Missing HP Damage" (Toll the Dead), "Healing", "Conditional", "Combined", "Combined 1 Handed"/"Combined 2 Handed" (label rendered as "Total… Combined"). |
| `open` | bool | always | Whether the collapsible description should start open (true for cards/traits/items). |

Rendering notes:

- Whisper HIDE_NAMES: `title` and `character` both become `hidden-monster-replacement`,
  `description` is dropped. For `avatar` displays the name is hidden for **any**
  whisper ≠ NO (roll_renderer.js `displayAvatar` — stricter than documented).
- If `hide-results-with-digital-dice` (or whisper-to-Discord-only + `hide-results-…`)
  is on, the DDB page suppresses its local display but the rendered-roll still goes to
  VTT tabs via the `sendMessage` path.
- An attack rolled with `rollAttack` and not `rollDamage` embeds a
  "Roll Damages" button in `html` (class `beyond20-button-roll-damages`); it only works
  on pages where Beyond20 itself wires it (DDB), not on your own render.

---

## 5. Roll, DiceRoll, DamageRollInfo shapes

`Roll.toJSON()` (dice.js L114):

| Field | Type | Notes |
|---|---|---|
| `formula` | string | e.g. `"1d20 + 5 + 1d4"` (custom-roll-dice folded in) |
| `parts` | (DiceRoll \| string \| number)[] | e.g. `[DiceRoll, "+", 5]` |
| `fail-limit` | number \| null | crit-fail threshold (default 1) |
| `critical-limit` | number \| null | crit threshold (default 20; 19 for Champion etc.; 1 when forced crit) |
| `critical-failure` | bool | computed |
| `critical-success` | bool | computed |
| `discarded` | bool | true for the losing advantage/disadvantage roll |
| `type` | string | `"to-hit"`, `"damage"`, `"critical-damage"`, `"skill-check"`, `"ability-check"`, `"saving-throw"`, `"initiative"`, `"hit-dice"`, `"death-save"`, `"custom"` |
| `total` | number | |

`DiceRoll.toJSON()` (dice.js L280): `{ total, formula ("2d6r<=2"), rolls: [{roll, discarded?}], amount, faces, modifiers }`.

`DamageRollInfo` = `[label, Roll-or-string, flags]`. Flags bitfield (roll_renderer.js `DAMAGE_FLAGS`):

| Flag | Value | Meaning |
|---|---|---|
| MESSAGE | 0 | Roll is a text message (roll field is a string), no other flag set |
| REGULAR | 1 | First/base damage |
| VERSATILE | 2 | Two-handed damage of a versatile weapon |
| ADDITIONAL | 4 | Any extra damage source |
| HEALING | 8 | Healing / Temp HP |
| CRITICAL | 16 | Critical-hit damage |
| CONDITIONAL | 32 | Situational damage (Booming Blade movement etc.) — excluded from totals |

---

## 6. The Beyond20Character object (`request.character`)

Whisper never censors this object — the name/HP are always inside it even when the
displayed strings are "???". If you honor HIDE_NAMES, censor at display time.

### `type: "Character"` — PC sheet (`dndbeyond/base/character.js` `getDict`)

| Field | Type | Notes |
|---|---|---|
| `name` | string | |
| `source` | string | `"D&D Beyond"` |
| `avatar` | string \| null | portrait URL |
| `id` | string | DDB character id (from URL) |
| `type` | `"Character"` | |
| `url` | string | sheet URL |
| `abilities` | [name, ABBR, score, mod][] | e.g. `["Strength","STR","12","+1"]` — all strings |
| `classes` | {className: levelString} | |
| `level` | string | total level |
| `race` | string | |
| `ac` | string | |
| `proficiency` | string | e.g. `"+3"` |
| `speed` | number | |
| `hp` | number | current (excludes temp) |
| `max-hp` | number | |
| `temp-hp` | number | |
| `exhaustion` | number | |
| `conditions` | string[] | |
| `settings` | object | character settings (section 10); features stripped out |
| `discord-target` | string \| undefined | |
| `class-features` | string[] | includes "Feature: Option" entries; 2024 features suffixed " 2024" |
| `racial-traits` | string[] | |
| `feats` | string[] | |
| `actions` | string[] | |
| `spell_modifiers` | {class: mod} | |
| `spell_saves` | {class: DC} | |
| `spell_attacks` | {class: mod} | |
| `version` | number | 2014 or 2024 ruleset. **DOC-DIVERGENCE: not in api.md at all.** |

No `saves`/`skills` maps on a PC (those exist only on stat-block types). PC save/skill
modifiers arrive per-roll in `request.modifier`.

### `type: "Monster" | "Vehicle" | "Creature" | "Extra-Vehicle"` (`monster.js` / `extras.js` `getDict`)

| Field | Type | Notes |
|---|---|---|
| `name`, `source`, `avatar`, `type`, `url` | | as above |
| `creatureType` | string \| undefined | Creature/Extra only: "Familiar", "Wild Shape", "Beast Companion", … |
| `settings` | object \| undefined | only for Wild Shape creatures (parent character's settings) |
| `id` | string | monster id; creature name for extras |
| `ac` | string | |
| `hp` | string \| number | |
| `hp-formula` | string | e.g. `"8d8 + 16"` |
| `max-hp` | number | extras only in practice |
| `temp-hp` | number | extras only in practice |
| `speed` | string | full speed line |
| `abilities` | [name, ABBR, score, mod][] | |
| `actions` | string[] | |
| `discord-target` | string \| undefined | |
| `saves` | {ABBR: mod} | from stat block |
| `skills` | {Skill: mod} | from stat block |
| `cr` | string | challenge rating |

### Loose types — `"spell"`, `"item"`, `"feat"`, `"source"` pages (`base.js` `getDict`)

Only `{ name, source: "D&D Beyond", type, url }`. `name` is the page title. No avatar,
no stats. Any site-authored character (via `SendMessage`) can use any `type` string.

---

## 7. hp-update and conditions-update

Both carry exactly `{ action, character }` with the full character dict. DOM events add
the convenience args listed in section 2.

- **hp-update** — sent whenever the parsed sheet HP (current/max/temp) changes, and
  once on sheet load. When a death-save section is visible, hp is forced to 0. Also
  sent by creature panes (extras) and monster stat blocks with HP trackers. **Gated by
  the global `update-hp` setting (default on) at the sender** — off means no event at all.
- **conditions-update** — sent when the conditions list or exhaustion level changes
  (also once on load). Conditions are the DDB names ("Blinded", "Poisoned", …);
  exhaustion is separate. **Not gated at the sender**: `display-conditions` is applied
  by the Roll20/Foundry receivers only. A custom domain always receives the event and
  gets `display-conditions` in the settings dict to honor (or not) itself.

---

## 8. update-combat (DDB encounter / combat tracker)

From `content-scripts/encounter.js`, gated by `sync-combat-tracker` (default on).
Sent whenever the tracker content changes (deep-compared, so no spam):

```
{ action: "update-combat",
  combat: [ { name, initiative, turn, tags } ] }   // ordered as displayed (initiative order)
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | combatant display name. DMs may rely on `combat-unknown-monster-name` for hidden monsters. |
| `initiative` | **string** | **DOC-DIVERGENCE:** api.md says Number; live it is the raw DOM text or input value — parse it yourself, may be `""`. |
| `turn` | bool | true for the active combatant |
| `tags` | string[] | from `combatant-card--*` classes: `character`, `monster`, `is-healthy`, `is-critical`, … (open-ended) |

No HP, no ids — names and order only. DOM event: `Beyond20_UpdateCombat`
`[request, combat, settings]`.

---

## 9. Enums

`WhisperType` (settings.js): 0 NO · 1 YES · 2 QUERY (never on the wire) · 3 HIDE_NAMES
(public roll, names/description censored in rendered strings — the character *object*
is not censored).

`RollType`: 0 NORMAL · 1 DOUBLE (roll twice, show both) · 2 QUERY (never on the wire) ·
3 ADVANTAGE · 4 DISADVANTAGE · 5 THRICE · 6 SUPER_ADVANTAGE · 7 SUPER_DISADVANTAGE ·
(8/9 OVERRIDE_* are internal, resolved before sending).

Advantage manifests in `attack_rolls`: ADVANTAGE/DISADVANTAGE → 2 Roll entries, loser
`discarded: true`; DOUBLE → 2 entries, none discarded; THRICE → 3 entries none
discarded; SUPER_* → 3 entries, 2 discarded. NORMAL → 1 entry.

`CriticalRules` (`critical-homebrew` setting): 0 PHB (roll crit dice) · 1 HOMEBREW_MAX
(max base + roll) · 2 HOMEBREW_DOUBLE · 3 HOMEBREW_MOD · 4 HOMEBREW_REROLL. Affects
what lands in `critical-damages` / crit rolls.

---

## 10. Settings that change what you receive

Global (in the `Loaded`/`NewSettings` dict):

| Setting | Default | Effect on payloads |
|---|---|---|
| `whisper-type` / `whisper-type-monsters` | NO / YES | Sets `request.whisper`. Monster/vehicle rolls use the monster value when ≠ NO. |
| `roll-type` | NORMAL | Sets `request.advantage`; QUERY prompts the user first. |
| `use-digital-dice` | true | On: dice resolve on DDB, you get the DDB render (no `rendered` field) with `request.sendMessage: true`. Off: you get the `fallback` render only. |
| `auto-roll-damage` | true | Off: attacks come with `rollDamage: false` → no `damage_rolls` until the user rolls damage separately. |
| `critical-homebrew` | PHB | Shapes crit damage content. |
| `weapon-force-critical` | false | Adds `rollCritical: true`, `critical-limit: 1`. |
| `update-hp` | true | Off: no `hp-update` at all. |
| `display-conditions` | true | Receiver-side only for Roll20/FVTT; custom domains always get the event. |
| `sync-combat-tracker` | true | Off: no `update-combat`. |
| `initiative-tiebreaker` | false | On: `initiative` modifier becomes a decimal string (DEX/100). |
| `components-display` / `component-prefix` | "all" / "Components: " | Which components line appears in spell `roll_info` ("all" / "material" / "none"). |
| `hidden-monster-replacement` | "???" | The string substituted for `title` / `character` on HIDE_NAMES. |
| `hide-results-with-digital-dice`, `hide-results-on-whisper-to-discord` | false | DDB-side display only; VTT still receives. |
| `custom-domains` | [] | Which sites get the generic content script at all. |
| `vtt-tab` | null | `vtt: "dndbeyond"` kills all forwarding; a Roll20/FVTT campaign limit does **not** exclude custom tabs. |
| `roll-to-game-log` | true | DDB-side game-log echo only. |
| `subst-vtt`, `roll20-template`, `roll20-spell-*` | | Roll20-only rendering knobs; no effect on custom domains. |

Character settings (inside `request.character.settings`; PC and Wild Shape creature only):

- `custom-roll-dice` — extra formula appended to every d20 roll. **Already folded into
  the rolled formulas you receive**, but api.md tells VTTs to also honor it when they
  re-roll from the raw request. Bless/Bane/exhaustion-2024 and hotkey modifiers are
  appended to this field on the fly per-roll.
- `custom-damage-dice`, `custom-ability-modifier`, `custom-critical-limit` — folded into
  damages / modifiers / `critical-limit` before sending.
- `versatile-choice` ("both"/"one"/"two"), `toll-choice` — shape which damage entries appear.
- `effects-bless/bane/enlarge/reduce/exhaustion-2014/exhaustion-2024` — inject
  `effects` names and adjust advantage/modifiers.
- ~90 class/feat toggles (`rogue-sneak-attack`, `great-weapon-master`, `barbarian-rage`,
  …) — all consumed at build time; they change damages/modifiers, not the schema.
- `conditions`, `exhaustion-level` — the persistence backing conditions-update (stripped
  from the settings copy in the dict; surfaced as `character.conditions`/`.exhaustion`).
- `discord-target` — Discord routing hint, also copied to `character["discord-target"]`.

---

## 11. Reverse direction — what our page can send

Dispatch `Beyond20_SendMessage` on `document` with `detail = [request]`
(`generic-site/content-script.js` `sendMessageToBeyond20`):

- Allowed `action` values (anything else is rejected with a console error):
  `roll`, `rendered-roll`, `hp-update`, `conditions-update`, `update-combat`.
- The message goes to the background and is forwarded to **all** VTT tabs — including
  other custom-domain tabs and Roll20/Foundry. This is how a site acts as a character
  sheet: build a `roll` request (any `type`, any `character` object with at least
  `name`/`type`/`url`) and other VTTs will render it. Your own tab does not receive an
  echo of its own send.
- The response report (`{success, vtt: ["roll20"|"fvtt"|"custom"|"dndbeyond"], error,
  request}`) is **discarded** by the generic content script — the page cannot observe
  delivery success.
- The same listener exists on D&D Beyond pages (`_sendCustomMessageToBeyond20`), same
  allowed list.
- There is no page-accessible path to `get-character`, `forward`, `open-options`, or
  the sheet itself — those are extension-internal (browser popup ↔ tab). Nothing a VTT
  page sends can modify the DDB sheet; `hp-update`/`conditions-update` sent from a page
  only notify *other* VTT tabs, DDB does not apply them.

---

## 12. What custom domains do NOT get (official-VTT-only features)

All the *data* above is identical across VTTs — the differences are receiver behavior:

- **Foundry**: applies `hp-update` to actual tokens/actors, applies conditions as token
  status effects (`display-conditions`), adds initiative rolls into the Foundry combat
  tracker (`initiative-tracker` setting), rolls `roll` requests with Foundry's own dice
  and chat. A custom domain must implement any of this itself from the events.
- **Roll20**: chat templates (`roll20-template`), dice substitution in chat
  (`subst-vtt`), conditions posted as `/em` chat lines, avatar posts, and an internal
  `Beyond20_CombatTracker` page event. `vtt-tab` can pin a specific Roll20/Foundry
  campaign; custom domains cannot be pinned (they always receive).
- **Alertify UI**: Beyond20 injects its own prompt dialogs (advantage query, whisper
  query, Chaos Bolt damage-type query) into the *sending* page; by the time a message
  reaches you all queries are resolved.
- **Discord integration** runs entirely on the sender side; `discord-target` is
  informational for you.

Nothing else is withheld: rendered-roll, hp-update, conditions-update, update-combat
and settings all reach custom domains with the same payloads.

---

## 13. Our bridge today vs what's available

`session/client/src/modules/rolls/beyond20.ts` (`translateRenderedRoll`) currently keeps:
`title` (fallback `request.name`), `formula` + `total` (kept attack roll, else first
damage roll), a kept/discarded dice breakdown for multi-d20 rolls, a `total_damages`
summary, `whisper===1 → private`, and `characterName`.

Two live bugs against the real payload:

1. **characterName is always lost.** The bridge reads `obj(req.character).name`, but
   `character` is a string — `obj()` returns `{}` and name is `undefined`. Fix: use the
   string itself (already censored for HIDE_NAMES), or `req.request.character.name`
   when the raw name is wanted.
2. **The damage summary is always empty.** `total_damages` values are Roll JSON
   *objects*, not strings, so `cap(total, 40)` returns `undefined` and every entry is
   filtered out. Fix: read `num(obj(v).total)` (and optionally `obj(v).formula`).

Highest-value unused fields for the table log, roughly in order:

1. `request.type` — roll kind (skill/save/attack/spell/initiative/death-save/…) for
   icons, filtering, and initiative capture that doesn't depend on title text.
2. `request.character` — the full object: `avatar` for the log line, `type`
   (PC vs Monster), `hp`/`max-hp`/`ac`/`level` for a hover card.
3. `attack_rolls[].critical-success` / `critical-failure` — nat-20/nat-1 highlighting;
   also `parts` for a per-die breakdown tooltip.
4. `damage_rolls` — per-type damage lines with flags (critical, healing, conditional)
   instead of a flattened string.
5. `request.advantage` — advantage/disadvantage badge (currently inferable only from
   the two-dice breakdown).
6. `roll_info` — save DC, effects (Bless/Bane), mastery, spell components, roll-table
   results; cheap `[name, value]` pairs, ready to display.
7. `Beyond20_UpdateHP` / `Beyond20_UpdateConditions` — live HP and condition sync from
   the sheet to our tokens (this is the Foundry-parity feature).
8. `Beyond20_UpdateCombat` — DDB encounter tracker → our initiative module (names,
   order, active turn).
9. `description` + `attributes` + `source` + `open` — spell/item/trait cards.
10. `play_sound` and `request.preview` — dice sound trigger and item/spell art.

Whisper note: `whisper === 3` (HIDE_NAMES) is public-but-censored; the strings we
already use (`title`, the `character` string) arrive pre-censored, but anything read
from `request.character` is not — censor at display time if we surface it.
