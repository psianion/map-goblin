import { afterEach, describe, expect, it } from 'vitest';
import { createBackgroundLayer, createDungeonLayer } from '../store/factories';
import {
  editorShowsLighting,
  getEditorDesk,
  holdAuthoredLook,
  setAuthoredLookHold,
  setEditorDesk,
  sheetColor,
  type EditorDesk,
} from './editorDesk';

const desk: EditorDesk = { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' };

describe('sheetColor', () => {
  it('draws a stock background on the desk paper', () => {
    const bg = createBackgroundLayer();
    expect(sheetColor([bg], desk)).toBe('#fbfbfb');
  });

  it('draws on the desk paper when there is no background layer', () => {
    expect(sheetColor([createDungeonLayer('Layer 1')], desk)).toBe('#fbfbfb');
  });

  it('draws an authored colour on the desk paper too: no dark sheet on the desk, ever', () => {
    for (const backgroundColor of ['#3a5a40', '#0a0908', '#0F100E', '#000000']) {
      const bg = { ...createBackgroundLayer(), backgroundColor };
      expect(sheetColor([bg], desk)).toBe('#fbfbfb');
    }
  });

  it('keeps a textured background as authored, even on the stock colour', () => {
    const bg = { ...createBackgroundLayer(), backgroundTexture: 'grass-a-09' };
    expect(sheetColor([bg], desk)).toBe('#2d2d2d');
  });

  it('is the authored colour with no desk installed', () => {
    expect(sheetColor([createBackgroundLayer()], null)).toBe('#2d2d2d');
  });
});

describe('holdAuthoredLook', () => {
  afterEach(() => {
    setEditorDesk(null);
    setAuthoredLookHold(null);
  });

  it('does nothing without a desk', () => {
    let held = 0;
    setAuthoredLookHold(() => {
      held++;
      return () => {};
    });
    holdAuthoredLook()();
    expect(held).toBe(0);
  });

  it('holds and releases while a desk is installed', () => {
    const log: string[] = [];
    setAuthoredLookHold(() => {
      log.push('hold');
      return () => log.push('release');
    });
    setEditorDesk(desk);
    expect(getEditorDesk()).toBe(desk);
    const release = holdAuthoredLook();
    expect(log).toEqual(['hold']);
    release();
    expect(log).toEqual(['hold', 'release']);
  });
});

describe('lit', () => {
  afterEach(() => setEditorDesk(null));

  it('is off unless the host asks for it', () => {
    setEditorDesk(desk);
    expect(getEditorDesk()?.lit ?? false).toBe(false);
    setEditorDesk({ ...desk, lit: true });
    expect(getEditorDesk()?.lit).toBe(true);
  });

  it('leaves the sheet colour alone', () => {
    const bg = createBackgroundLayer();
    expect(sheetColor([bg], { ...desk, lit: true })).toBe(sheetColor([bg], desk));
  });
});

describe('holdAuthoredLook for a file', () => {
  afterEach(() => {
    setEditorDesk(null);
    setAuthoredLookHold(null);
  });

  it('asks the hold for a lit look by default', () => {
    const asked: unknown[] = [];
    setAuthoredLookHold((opts) => {
      asked.push(opts);
      return () => {};
    });
    setEditorDesk(desk);
    holdAuthoredLook()();
    holdAuthoredLook({ lit: true })();
    expect(asked).toEqual([{ lit: true }, { lit: true }]);
  });

  it('passes an unlit file on to the hold', () => {
    const asked: unknown[] = [];
    setAuthoredLookHold((opts) => {
      asked.push(opts);
      return () => {};
    });
    setEditorDesk(desk);
    holdAuthoredLook({ lit: false })();
    expect(asked).toEqual([{ lit: false }]);
  });

  it('holds an unlit file even without a desk, to take the hour off the background', () => {
    const asked: unknown[] = [];
    setAuthoredLookHold((opts) => {
      asked.push(opts);
      return () => {};
    });
    holdAuthoredLook({ lit: false })();
    holdAuthoredLook({ lit: true })();
    expect(asked).toEqual([{ lit: false }]);
  });
});

describe('editorShowsLighting', () => {
  afterEach(() => setEditorDesk(null));

  it('is on without a desk: the plain editor and the table always show the lighting', () => {
    expect(editorShowsLighting()).toBe(true);
  });

  it('follows the desk lit preview', () => {
    setEditorDesk(desk);
    expect(editorShowsLighting()).toBe(false);
    setEditorDesk({ ...desk, lit: true });
    expect(editorShowsLighting()).toBe(true);
  });
});
