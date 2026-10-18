import { describe, expect, it } from 'vitest'
import { ComponentType, type APILabelComponent } from 'discord.js'
import {
  APPLY_FIELDS,
  campaignSettingsFields,
  CAMPAIGN_SETUP_FIELDS,
  characterFields,
  FEEDBACK_FIELDS,
  HANDOUT_FIELDS,
  modal,
  RECRUIT_FIELDS,
  type ModalField,
} from './modals'
import { CLASSES } from '../features/character'
import { FEEDBACK_CATEGORIES } from '../features/feedback'
import { EXPERIENCE_LEVELS, RECRUIT_TAGS } from '../features/lfg'
import type { Character } from '../db/stores'

const json = (fields: readonly ModalField[]) => modal('ns:action:user-1', 'A form', fields).toJSON()
/** Every field is a Label — that is the thing under test, so the cast says it out loud. */
const labels = (fields: readonly ModalField[]) => json(fields).components as APILabelComponent[]

describe('modal', () => {
  it('wraps every field in a Label that carries the description — never a bare input', () => {
    const built = json(CAMPAIGN_SETUP_FIELDS)
    expect(built.custom_id).toBe('ns:action:user-1')
    for (const label of built.components as APILabelComponent[]) {
      expect(label.type).toBe(ComponentType.Label)
      expect(label.label.length).toBeGreaterThan(0)
      expect(label.description?.length).toBeGreaterThan(0)
      expect(label.component.type).not.toBe(ComponentType.ActionRow)
    }
  })

  it('refuses to build past Discord’s five top-level components', () => {
    const six = [...CAMPAIGN_SETUP_FIELDS, { id: 'extra', label: 'One too many', kind: 'short' } as const]
    expect(() => json(six)).toThrowError(/max 5/)
  })

  it('offers all thirteen classes, and a portrait upload that may be left empty', () => {
    const [, klass, , portrait] = labels(characterFields())
    expect(klass.component).toMatchObject({ type: ComponentType.StringSelect, custom_id: 'class' })
    expect((klass.component as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([...CLASSES])
    expect(portrait.component).toMatchObject({ type: ComponentType.FileUpload, min_values: 0, max_values: 1 })
  })
})

describe('the sets 5–7 forms', () => {
  it('asks for seats with a select and the tags with an optional checkbox group', () => {
    const [blurb, seats, tags] = labels(RECRUIT_FIELDS)
    expect(blurb.component).toMatchObject({ type: ComponentType.TextInput, max_length: 1000 })
    expect((seats.component as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([
      '1', '2', '3', '4', '5', '6',
    ])
    expect(tags.component).toMatchObject({ type: ComponentType.CheckboxGroup, required: false })
    expect((tags.component as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([...RECRUIT_TAGS])
  })

  it('asks experience as a radio group, with the pitch optional and availability not', () => {
    const [pitch, experience, availability] = labels(APPLY_FIELDS)
    expect(pitch.component).toMatchObject({ required: false })
    expect(experience.component).toMatchObject({ type: ComponentType.RadioGroup, required: true })
    expect((experience.component as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([
      ...EXPERIENCE_LEVELS,
    ])
    expect(availability.component).toMatchObject({ required: true, max_length: 100 })
  })

  it('fits the handout into the five it is allowed, with ten uploads and a spoiler checkbox', () => {
    const fields = labels(HANDOUT_FIELDS)
    expect(fields).toHaveLength(5)
    expect(fields[2].component).toMatchObject({ type: ComponentType.FileUpload, min_values: 0, max_values: 10 })
    expect(fields[4].component).toMatchObject({ type: ComponentType.Checkbox, custom_id: 'spoiler' })
  })

  it('puts the feedback category first, as one tap before the typing', () => {
    const [category, text] = labels(FEEDBACK_FIELDS)
    expect((category.component as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([
      ...FEEDBACK_CATEGORIES,
    ])
    expect(text.component).toMatchObject({ type: ComponentType.TextInput, max_length: 1000, required: true })
  })
})

describe('the prefilled update form', () => {
  const character: Character = {
    id: 3,
    discordId: 'user-1',
    campaignId: 'camp-1',
    name: 'Thalor',
    className: 'Ranger',
    level: 6,
    portraitUrl: null,
    lastPlayed: null,
  }

  it('fills the name and level in, and marks the class they already are', () => {
    const [name, klass, level] = labels(characterFields(character))
    expect(name.component).toMatchObject({ value: 'Thalor' })
    expect(level.component).toMatchObject({ value: '6' })
    const options = (klass.component as { options: { value: string; default?: boolean }[] }).options
    expect(options.filter((o) => o.default).map((o) => o.value)).toEqual(['Ranger'])
  })

  it('says the portrait field keeps what is there, which the create form cannot say', () => {
    expect(labels(characterFields(character))[3].description).toMatch(/keeps the one you have/)
    expect(labels(characterFields())[3].description).toMatch(/Optional/)
  })

  it('shows the D&D Beyond link already set rather than a blank that reads as unset', () => {
    const set = labels(campaignSettingsFields('https://www.dndbeyond.com/campaigns/1'))[1]
    expect(set.component).toMatchObject({ value: 'https://www.dndbeyond.com/campaigns/1' })
    expect(labels(campaignSettingsFields(null))[1].component).not.toHaveProperty('value')
  })
})
