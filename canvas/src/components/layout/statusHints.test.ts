// The node editors' status-bar line, shared by both status bars.
//
// A band's node mode has a different key map from a stone wall's, and while a
// joint drag is live it carries the solver's answer instead: which stones the
// kit chose, and how far it pulled the handle off the cursor. That last number
// is the one that tells a DM whether the constraint is helping or fighting.

import { describe, it, expect } from 'vitest';
import { bandRunIndex, SPINE_WALL_PREFIX } from '@/engine/wallNodeOverlay';
import { editHint, type EditHintTools } from './statusHints';

const tools = (over: Partial<EditHintTools> = {}): EditHintTools => ({
  nodeEditWallId: null,
  shapeNodeEditId: null,
  selectedNodeT: null,
  selectedNodeTs: [],
  bandDragStatus: null,
  ...over,
});
const hintFor = (over: Partial<EditHintTools>) => editHint(tools(over), bandRunIndex);
const selected = { selectedNodeT: 0.25, selectedNodeTs: [0.25] };

describe('editHint', () => {
  it('says nothing when no node editor is open', () => {
    expect(hintFor({})).toBeNull();
  });

  describe('cave band', () => {
    it('shows the band key map, not the stone one', () => {
      const h = hintFor({ nodeEditWallId: 'band:0', ...selected });
      expect(h?.kind).toBe('band');
      expect(h?.label).toBe('Editing cave wall');
      expect(h?.text).toBe('drag to move · { } insert · Del straighten · Tab re-lay wall · Esc done');
      expect(h?.text).not.toMatch(/rotate/);
    });

    it('names the chosen pieces and the kit pull while a drag is live', () => {
      const h = hintFor({
        nodeEditWallId: 'band:0',
        ...selected,
        bandDragStatus: { pieces: ['wall_short_2x4', 'inside_bend_2x2', 'wall_short_2x4'], kitPull: 0.4213 },
      });
      expect(h?.text).toBe('wall short 2x4, inside bend 2x2 · kit pull 0.42 cells');
      expect(h?.segments.some((s) => s.key)).toBe(false);
    });

    it('carries the refusal instead, in the words the solver used', () => {
      const h = hintFor({ nodeEditWallId: 'band:0', bandDragStatus: { refusal: 'the wall would have a hole in it' } });
      expect(h?.text).toBe('the wall would have a hole in it');
    });

    it('asks for a joint when none is picked', () => {
      expect(hintFor({ nodeEditWallId: 'band:0' })?.text).toBe(
        'click a joint · Shift+click groups · double-click elsewhere exits',
      );
    });
  });

  describe('wall', () => {
    it('leaves a stone wall reading exactly as it did', () => {
      const h = hintFor({ nodeEditWallId: 'wall-1', ...selected });
      expect(h?.kind).toBe('wall');
      expect(h?.label).toBe('Editing wall');
      expect(h?.text).toBe('[ ] rotate · - + size · , . gap · Tab piece · { } insert · Del remove · Esc done');
    });

    it('asks for a stone when none is picked', () => {
      expect(hintFor({ nodeEditWallId: 'wall-1' })?.text).toBe(
        'click a stone · Shift+click groups · double-click elsewhere exits',
      );
    });

    it('marks the keys apart from the words around them', () => {
      const h = hintFor({ nodeEditWallId: 'wall-1', ...selected });
      const keys = h?.segments.filter((s) => s.key).map((s) => s.text);
      expect(keys).toEqual(['[', ']', '-', '+', ',', '.', 'Tab', '{', '}', 'Del', 'Esc']);
      const none = hintFor({ nodeEditWallId: 'wall-1' });
      expect(none?.segments.filter((s) => s.key).map((s) => s.text)).toEqual(['Shift']);
    });

    it('wins over an outline edit left open underneath', () => {
      expect(hintFor({ nodeEditWallId: 'wall-1', shapeNodeEditId: 'shape-1' })?.kind).toBe('wall');
    });
  });

  describe('drawn cave wall', () => {
    const id = SPINE_WALL_PREFIX + 'w1';
    it('says the line is being edited and the rock follows, with no stone or floor keys', () => {
      const none = hintFor({ nodeEditWallId: id });
      expect(none?.label).toBe('Editing cave wall');
      expect(none?.text).toBe('drag a corner of the line, the rock follows · Esc done');
      const picked = hintFor({ nodeEditWallId: id, ...selected });
      expect(picked?.text).toBe('drag the corner, the rock follows · Del removes it · Esc done');
      for (const h of [none, picked]) {
        expect(h?.text).not.toMatch(/rotate|floor|outline|joint/);
      }
    });
  });

  describe('outline', () => {
    it('shows the outline key map', () => {
      const h = hintFor({ shapeNodeEditId: 'shape-1' });
      expect(h?.kind).toBe('outline');
      expect(h?.label).toBe('Editing outline');
      expect(h?.text).toBe(
        'drag a corner to move it · click a midpoint to add one · Delete removes · Alt curves · Esc done',
      );
      expect(h?.segments.filter((s) => s.key).map((s) => s.text)).toEqual(['Delete', 'Alt', 'Esc']);
    });
  });

  it('hands back the same hint for the same mode, so a re-read does not re-render', () => {
    expect(hintFor({ shapeNodeEditId: 'a' })).toBe(hintFor({ shapeNodeEditId: 'b' }));
  });
});
