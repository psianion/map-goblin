// Modal *definitions*: the one place a command's field labels, descriptions and placeholders
// live. A modal is Discord builders, so it cannot sit in a feature file — what the submitted
// values are checked against still does (features/character.ts, readDdbUrl).
//
// Every field sits in a Label — Discord refuses a bare text input in a modal — and the Label
// carries the description, which says the format or the limit rather than repeating the name.
// Five top-level components is the cap, which is why role and the D&D Beyond link are their
// own `/campaign settings` form.

import {
  ChannelSelectMenuBuilder,
  ChannelType,
  CheckboxBuilder,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ModalSubmitInteraction,
} from 'discord.js'
import { CLASSES, LEVEL_MAX, LEVEL_MIN, MAX_CHARACTER_NAME } from '../features/character'
import { FEEDBACK_CATEGORIES, MAX_FEEDBACK } from '../features/feedback'
import { MAX_HANDOUT_BODY, MAX_HANDOUT_TITLE } from '../features/handout'
import {
  EXPERIENCE_LEVELS,
  MAX_AVAILABILITY,
  MAX_BLURB,
  MAX_PITCH,
  RECRUIT_TAGS,
  SEAT_COUNTS,
} from '../features/lfg'
import type { Character } from '../db/stores'

interface FieldBase {
  id: string
  /** Names the field. Max 45 characters. */
  label: string
  /** The format or the limit, under the label. Max 100 characters. */
  description?: string
  /** Defaults to true, as Discord's own does. */
  required?: boolean
}

/** One field: what it is called, what it accepts, and the id it is read back under. */
export type ModalField =
  | (FieldBase & { kind: 'short' | 'paragraph'; placeholder?: string; maxLength?: number; value?: string })
  | (FieldBase & { kind: 'select' | 'radio'; options: readonly string[]; value?: string })
  | (FieldBase & { kind: 'checkboxes'; options: readonly string[] })
  | (FieldBase & { kind: 'checkbox' })
  | (FieldBase & { kind: 'channel' | 'user' | 'role' })
  | (FieldBase & { kind: 'upload'; max: number })

/** Discord's cap on a modal's top-level components. Overflowing it fails at show time. */
const MAX_FIELDS = 5

export function modal(customId: string, title: string, fields: readonly ModalField[]): ModalBuilder {
  if (fields.length > MAX_FIELDS)
    throw new Error(`modal "${title}" has ${fields.length} fields, max ${MAX_FIELDS}`)
  const built = new ModalBuilder().setCustomId(customId).setTitle(title)
  for (const field of fields) built.addLabelComponents(labelFor(field))
  return built
}

function labelFor(field: ModalField): LabelBuilder {
  const built = new LabelBuilder().setLabel(field.label)
  if (field.description) built.setDescription(field.description)
  const required = field.required !== false

  if (field.kind === 'short' || field.kind === 'paragraph') {
    // No label on the input itself: inside a Label, Discord rejects one.
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setStyle(field.kind === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(required)
    if (field.placeholder) input.setPlaceholder(field.placeholder)
    if (field.maxLength) input.setMaxLength(field.maxLength)
    if (field.value) input.setValue(field.value)
    return built.setTextInputComponent(input)
  }

  if (field.kind === 'select') {
    return built.setStringSelectMenuComponent(
      new StringSelectMenuBuilder().setCustomId(field.id).setRequired(required).addOptions(
        field.options.map((option) =>
          new StringSelectMenuOptionBuilder().setLabel(option).setValue(option).setDefault(option === field.value),
        ),
      ),
    )
  }

  // Radio and checkboxes over a select when the whole list fits on screen: the answer is
  // visible without opening anything, which is what makes a three-option question one tap.
  if (field.kind === 'radio') {
    return built.setRadioGroupComponent(
      new RadioGroupBuilder().setCustomId(field.id).setRequired(required).addOptions(
        field.options.map((option) =>
          new RadioGroupOptionBuilder().setLabel(option).setValue(option).setDefault(option === field.value),
        ),
      ),
    )
  }

  if (field.kind === 'checkboxes') {
    return built.setCheckboxGroupComponent(
      new CheckboxGroupBuilder()
        .setCustomId(field.id)
        .setRequired(required)
        .addOptions(field.options.map((option) => new CheckboxGroupOptionBuilder().setLabel(option).setValue(option))),
    )
  }

  // A lone checkbox is a yes/no, so it has no required to set — unticked is an answer.
  if (field.kind === 'checkbox') return built.setCheckboxComponent(new CheckboxBuilder().setCustomId(field.id))

  if (field.kind === 'channel') {
    // Text channels only, everywhere: every channel the bot is given is one it posts cards in.
    return built.setChannelSelectMenuComponent(
      new ChannelSelectMenuBuilder().setCustomId(field.id).setRequired(required).setChannelTypes(ChannelType.GuildText),
    )
  }

  if (field.kind === 'user')
    return built.setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId(field.id).setRequired(required))

  if (field.kind === 'role')
    return built.setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId(field.id).setRequired(required))

  if (field.kind === 'upload')
    return built.setFileUploadComponent(
      // Optional by construction: min 0 is what lets an update keep the portrait it has.
      new FileUploadBuilder().setCustomId(field.id).setMinValues(0).setMaxValues(field.max).setRequired(false),
    )

  throw new Error(`unknown modal field kind for "${field.id}"`)
}

/**
 * A submitted modal as plain strings, keyed by field id — the shape the feature validators
 * take. A picker answers with the id it picked, an untouched optional field with ''. A
 * checkbox group answers with a comma list, which is also how its tags are stored; a lone
 * checkbox with 'true' or 'false'. Uploads are the exception: an attachment is not a string,
 * so a handler reads those off `interaction.fields.getUploadedFiles(id)` itself.
 */
export function modalValues(
  interaction: ModalSubmitInteraction,
  fields: readonly ModalField[],
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (field.kind === 'short' || field.kind === 'paragraph')
      values[field.id] = interaction.fields.getTextInputValue(field.id)
    else if (field.kind === 'select') values[field.id] = interaction.fields.getStringSelectValues(field.id)[0] ?? ''
    else if (field.kind === 'radio') values[field.id] = interaction.fields.getRadioGroup(field.id) ?? ''
    else if (field.kind === 'checkboxes') values[field.id] = interaction.fields.getCheckboxGroup(field.id).join(',')
    else if (field.kind === 'checkbox') values[field.id] = String(interaction.fields.getCheckbox(field.id))
    else if (field.kind === 'channel') values[field.id] = interaction.fields.getSelectedChannels(field.id)?.firstKey() ?? ''
    else if (field.kind === 'user') values[field.id] = interaction.fields.getSelectedUsers(field.id)?.firstKey() ?? ''
    else if (field.kind === 'role') values[field.id] = interaction.fields.getSelectedRoles(field.id)?.firstKey() ?? ''
  }
  return values
}

// ── the forms ────────────────────────────────────────────────────────────────────────────

/** Everything the bot routes by. Role and the D&D Beyond link are `/campaign settings`:
 * these five are already the cap, and these five are what nothing works without. */
export const CAMPAIGN_SETUP_FIELDS: readonly ModalField[] = [
  {
    id: 'name',
    label: 'Campaign name',
    description: 'What the party calls it. It heads every card the bot sends.',
    kind: 'short',
    placeholder: 'The Sunken Keep',
    maxLength: 60,
  },
  {
    id: 'id',
    label: 'Goblin campaign id',
    description: 'The uuid the game server knows it by — 8-4-4-4-12 characters.',
    kind: 'short',
    placeholder: '18358431-cfeb-46c8-b72b-9a9ac33f0eb8',
    maxLength: 60,
  },
  {
    id: 'channel',
    label: 'Player channel',
    description: 'Where the party plays. Commands work in campaign channels only.',
    kind: 'channel',
  },
  {
    id: 'dmChannel',
    label: 'DM-only channel',
    description: 'Where the unfogged map and anonymous feedback land.',
    kind: 'channel',
  },
  {
    id: 'dm',
    label: 'The DM',
    description: 'Who runs the table. Only they can use the DM-only commands.',
    kind: 'user',
  },
]

/** The two `/campaign setup` had to leave behind. `ddbUrl` is prefilled so reopening the form
 * shows what is set rather than a blank that looks unset. */
export function campaignSettingsFields(ddbUrl?: string | null): ModalField[] {
  return [
    {
      id: 'role',
      label: 'Campaign member role',
      description: 'Everyone holding this role counts as a player here.',
      kind: 'role',
    },
    {
      id: 'dndbeyond',
      label: 'D&D Beyond link',
      description: 'The campaign page on dndbeyond.com. Blank keeps the current one.',
      kind: 'short',
      required: false,
      placeholder: 'https://www.dndbeyond.com/campaigns/1234567',
      maxLength: 200,
      ...(ddbUrl ? { value: ddbUrl } : {}),
    },
  ]
}

/** One form for `/character create` and `/character update` — update arrives filled in, so a
 * level bump is two keystrokes and the name field doubles as the rename. */
export function characterFields(character?: Character): ModalField[] {
  return [
    {
      id: 'name',
      label: 'Character name',
      description: `Up to ${MAX_CHARACTER_NAME} characters.${character ? ' Change it to rename them.' : ''}`,
      kind: 'short',
      placeholder: 'Thalor Nightbreeze',
      maxLength: MAX_CHARACTER_NAME,
      ...(character ? { value: character.name } : {}),
    },
    {
      id: 'class',
      label: 'Class',
      description: 'One of the thirteen 5e classes.',
      kind: 'select',
      options: CLASSES,
      ...(character ? { value: character.className } : {}),
    },
    {
      id: 'level',
      label: 'Level',
      description: `${LEVEL_MIN} to ${LEVEL_MAX}.`,
      kind: 'short',
      placeholder: '3',
      maxLength: 2,
      ...(character ? { value: String(character.level) } : {}),
    },
    {
      id: 'portrait',
      label: 'Portrait',
      description: character
        ? 'PNG, JPG, WEBP or GIF, 8 MB max. Blank keeps the one you have.'
        : 'PNG, JPG, WEBP or GIF, 8 MB max. Optional.',
      kind: 'upload',
      max: 1,
    },
  ]
}

/** `/recruit open`. The blurb is the whole of the board post, so it is the one required
 * field; seats and tags are what a reader scans before reading any of it. */
export const RECRUIT_FIELDS: readonly ModalField[] = [
  {
    id: 'blurb',
    label: 'About the table',
    description: `What the table is like, when you play, what you are after. Up to ${MAX_BLURB} characters.`,
    kind: 'paragraph',
    placeholder: 'Weekly Sunday evenings, homebrew west marches, heavy on exploration.',
    maxLength: MAX_BLURB,
  },
  {
    id: 'seats',
    label: 'Seats open',
    description: 'How many players you are taking.',
    kind: 'select',
    options: SEAT_COUNTS,
  },
  {
    id: 'tags',
    label: "Who we're after",
    description: 'Tick any that apply. Shown on the board post.',
    kind: 'checkboxes',
    required: false,
    options: RECRUIT_TAGS,
  },
]

/** `/apply` and the board's Apply button — the same form either way, so the DM reads the
 * same three answers whichever one the applicant pressed. */
export const APPLY_FIELDS: readonly ModalField[] = [
  {
    id: 'pitch',
    label: 'Your pitch',
    description: `Who you are and what you want to play. Optional, up to ${MAX_PITCH} characters.`,
    kind: 'paragraph',
    required: false,
    placeholder: 'I have played a couple of years, mostly martials, and I would love a rogue.',
    maxLength: MAX_PITCH,
  },
  {
    id: 'experience',
    label: 'Experience with D&D',
    description: 'Roughly how much you have played.',
    kind: 'radio',
    options: EXPERIENCE_LEVELS,
  },
  {
    id: 'availability',
    label: 'When you can play',
    description: `Evenings, days, timezone — whatever narrows it. Up to ${MAX_AVAILABILITY} characters.`,
    kind: 'short',
    placeholder: 'Weeknights after 8, Sunday afternoons',
    maxLength: MAX_AVAILABILITY,
  },
]

/** `/handout`. Every field is optional on its own — a picture, a note or a game-server asset
 * is each a handout by itself — so the "give me something" check is the submit's, not a
 * field's. These five are the cap, which is why the DM's own channel picks no channel here. */
export const HANDOUT_FIELDS: readonly ModalField[] = [
  {
    id: 'title',
    label: 'Title',
    description: `Heads the card. Blank reads "From the DM". Up to ${MAX_HANDOUT_TITLE} characters.`,
    kind: 'short',
    required: false,
    placeholder: 'The letter from the Duke',
    maxLength: MAX_HANDOUT_TITLE,
  },
  {
    id: 'body',
    label: 'What it says',
    description: `Quoted on the card, line breaks kept. Up to ${MAX_HANDOUT_BODY} characters.`,
    kind: 'paragraph',
    required: false,
    placeholder: 'Read this before next session.',
    maxLength: MAX_HANDOUT_BODY,
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Up to 10. Images show in the card, anything else is attached to it.',
    kind: 'upload',
    max: 10,
  },
  {
    id: 'asset',
    label: 'Game asset id',
    description: 'A picture already on the game server, fetched and attached.',
    kind: 'short',
    required: false,
    placeholder: 'asset-7',
    maxLength: 100,
  },
  {
    id: 'spoiler',
    label: 'Blur until opened',
    description: 'The party has to click before they see any of it.',
    kind: 'checkbox',
  },
]

/** `/feedback`. The category is the DM's sorting, and it is one tap — the whole point of this
 * command is that saying something costs almost nothing. */
export const FEEDBACK_FIELDS: readonly ModalField[] = [
  {
    id: 'category',
    label: 'What kind',
    description: 'How the DM should read it.',
    kind: 'radio',
    options: FEEDBACK_CATEGORIES,
  },
  {
    id: 'text',
    label: 'Your feedback',
    description: `Goes to the DM with no name on it. Up to ${MAX_FEEDBACK} characters.`,
    kind: 'paragraph',
    placeholder: 'The ambush was great. The market scene went long.',
    maxLength: MAX_FEEDBACK,
  },
]
