import { describe, it, expect } from 'vitest';
import { lightStatePatch, sharedLightState, shownAssetId, startStateOf, type LightStates } from './propLights';
import { burnsAsEmbers, EMBERS, shownLight } from './lightEmbers';
import type { LightChild } from './types';

const PAIR: LightStates = { on: 'gg-demo:candle_lit', off: 'gg-demo:candle_unlit' };
const BRAZIER: LightStates = { off: 'gg-demo:brazier_a', embers: 'gg-demo:brazier_b', on: 'gg-demo:brazier_c' };
const on = { visible: true };
const off = { visible: false };
const embers = { visible: true, embers: true as const };

describe('shownAssetId', () => {
  it('keeps the prop`s own picture without states or without an attached light', () => {
    expect(shownAssetId({ assetId: 'gg-demo:campfire' }, undefined, [off])).toBe('gg-demo:campfire');
    expect(shownAssetId({ assetId: PAIR.on! }, PAIR, [])).toBe(PAIR.on);
    expect(shownAssetId({ assetId: PAIR.off! }, PAIR, [])).toBe(PAIR.off);
  });

  it('shows the lit picture while any attached light is on, the unlit one when all are off', () => {
    expect(shownAssetId({ assetId: PAIR.off! }, PAIR, [on])).toBe(PAIR.on);
    expect(shownAssetId({ assetId: PAIR.on! }, PAIR, [off])).toBe(PAIR.off);
    expect(shownAssetId({ assetId: PAIR.on! }, PAIR, [off, on])).toBe(PAIR.on);
    expect(shownAssetId({ assetId: PAIR.on! }, PAIR, [off, off])).toBe(PAIR.off);
  });

  it('shows a brazier`s three pictures, and a pair with no embers picture shows On for embers', () => {
    expect(shownAssetId({ assetId: BRAZIER.on! }, BRAZIER, [off])).toBe(BRAZIER.off);
    expect(shownAssetId({ assetId: BRAZIER.off! }, BRAZIER, [embers])).toBe(BRAZIER.embers);
    expect(shownAssetId({ assetId: BRAZIER.off! }, BRAZIER, [on])).toBe(BRAZIER.on);
    expect(shownAssetId({ assetId: BRAZIER.off! }, BRAZIER, [embers, on])).toBe(BRAZIER.on);
    // Off keeps `embers` set: the picture is still the cold one.
    expect(shownAssetId({ assetId: BRAZIER.on! }, BRAZIER, [{ visible: false, embers: true }])).toBe(BRAZIER.off);
    expect(shownAssetId({ assetId: PAIR.off! }, PAIR, [embers])).toBe(PAIR.on);
  });
});

describe('startStateOf', () => {
  it('reads the starting state off the picture placed', () => {
    expect(startStateOf(PAIR.on!, PAIR)).toBe('on');
    expect(startStateOf(PAIR.off!, PAIR)).toBe('off');
    expect(startStateOf(BRAZIER.off!, BRAZIER)).toBe('off');
    expect(startStateOf(BRAZIER.embers!, BRAZIER)).toBe('embers');
    expect(startStateOf(BRAZIER.on!, BRAZIER)).toBe('on');
    expect(startStateOf('gg-demo:campfire', undefined)).toBe('on');
  });
});

describe('light state', () => {
  it('patches each state, and Off keeps embers for the way back', () => {
    expect(lightStatePatch('off')).toEqual({ visible: false });
    expect(lightStatePatch('embers')).toEqual({ visible: true, embers: true });
    expect(lightStatePatch('on')).toEqual({ visible: true, embers: undefined });
  });

  it('reads a shared state, or mixed', () => {
    expect(sharedLightState([on, on])).toBe('on');
    expect(sharedLightState([embers])).toBe('embers');
    expect(sharedLightState([off, { visible: false, embers: true }])).toBe('off');
    expect(sharedLightState([on, off])).toBe('mixed');
    expect(sharedLightState([])).toBe('off');
  });
});

describe('embers', () => {
  const light = {
    visible: true,
    radius: 9,
    featherRadius: 6,
    intensity: 1,
    color: '#ff8e3c',
  } as Pick<LightChild, 'visible' | 'radius' | 'featherRadius' | 'intensity' | 'color' | 'embers'>;

  it('lights with a third of the reach, 60 % of the strength and the ember red', () => {
    const shown = shownLight({ ...light, embers: true });
    expect(shown.radius).toBeCloseTo(3);
    expect(shown.featherRadius).toBeCloseTo(2);
    expect(shown.intensity).toBeCloseTo(EMBERS.intensity);
    expect(shown.color).toBe('#d0451b');
    expect(shown.embers).toBe(true);
  });

  it('leaves the light itself alone when it is on or off', () => {
    expect(shownLight(light)).toBe(light);
    const cold = { ...light, visible: false, embers: true as const };
    expect(shownLight(cold)).toBe(cold);
    expect(burnsAsEmbers(cold)).toBe(false);
  });
});
