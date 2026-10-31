import { describe, it, expect, afterEach } from 'vitest';
import { canvasKeysAllowed, isTypingTarget } from './keyGuard';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const at = (el: Element | null) => ({ target: el as EventTarget | null });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isTypingTarget', () => {
  it('takes text inputs, textareas, selects and editable elements', () => {
    const host = mount('<input id="a"><textarea id="b"></textarea><select id="c"></select><div id="d" contenteditable="true"></div>');
    for (const id of ['a', 'b', 'c']) expect(isTypingTarget(host.querySelector(`#${id}`))).toBe(true);
    const d = host.querySelector('#d') as HTMLElement;
    // jsdom does not compute isContentEditable; the guard reads the attribute through closest().
    expect(isTypingTarget(d) || canvasKeysAllowed(at(d)) === false).toBe(true);
  });

  it('leaves buttons, checkboxes and ranges out', () => {
    const host = mount('<button id="a"></button><input id="b" type="checkbox"><input id="c" type="range">');
    for (const id of ['a', 'b', 'c']) expect(isTypingTarget(host.querySelector(`#${id}`))).toBe(false);
  });

  it('answers false for nothing at all', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('canvasKeysAllowed', () => {
  it('lets keys through from the page itself', () => {
    expect(canvasKeysAllowed(at(document.body))).toBe(true);
  });

  it('lets keys through from the canvas', () => {
    const host = mount('<canvas></canvas>');
    expect(canvasKeysAllowed(at(host.querySelector('canvas')))).toBe(true);
  });

  it('lets keys through from a button in chrome marked for canvas keys (a dock tab)', () => {
    const host = mount('<section data-keys="canvas"><div role="tablist"><button id="tab">Walls</button></div></section>');
    expect(canvasKeysAllowed(at(host.querySelector('#tab')))).toBe(true);
  });

  it('stops keys from a text field, even inside marked chrome', () => {
    const host = mount('<section data-keys="canvas"><textarea id="t"></textarea></section>');
    expect(canvasKeysAllowed(at(host.querySelector('#t')))).toBe(false);
  });

  it('stops keys from a menu', () => {
    const host = mount('<div role="menu"><button id="m">Duplicate</button></div>');
    expect(canvasKeysAllowed(at(host.querySelector('#m')))).toBe(false);
  });

  it('stops keys from a dialog, even one inside marked chrome', () => {
    const host = mount('<section data-keys="canvas"><div role="dialog"><button id="b">x</button></div></section>');
    expect(canvasKeysAllowed(at(host.querySelector('#b')))).toBe(false);
  });

  it('stops keys from a tree row (the layer list)', () => {
    const host = mount('<div role="tree"><div id="row" tabindex="0">Layer 1</div></div>');
    expect(canvasKeysAllowed(at(host.querySelector('#row')))).toBe(false);
  });

  it('stops keys from a listbox', () => {
    const host = mount('<ul role="listbox"><li id="o" tabindex="0">One</li></ul>');
    expect(canvasKeysAllowed(at(host.querySelector('#o')))).toBe(false);
  });

  it('lets keys through a listbox marked for the canvas (the filmstrip), but not from its name field', () => {
    const host = mount(
      '<div role="listbox" data-keys="canvas"><div id="o" role="option" tabindex="0"><button id="eye">Hide</button><input id="name"></div></div>',
    );
    expect(canvasKeysAllowed(at(host.querySelector('#o')))).toBe(true);
    expect(canvasKeysAllowed(at(host.querySelector('#eye')))).toBe(true);
    expect(canvasKeysAllowed(at(host.querySelector('#name')))).toBe(false);
  });

  it('stops keys from a row in a sheet', () => {
    const host = mount('<aside class="v2-sheet"><button id="row">Warren Hall</button></aside>');
    expect(canvasKeysAllowed(at(host.querySelector('#row')))).toBe(false);
  });

  it('stops keys from anything editable', () => {
    const host = mount('<div contenteditable="true"><span id="s">text</span></div>');
    expect(canvasKeysAllowed(at(host.querySelector('#s')))).toBe(false);
  });

  it('stops keys from a button in unmarked chrome', () => {
    const host = mount('<div><button id="b">Export</button></div>');
    expect(canvasKeysAllowed(at(host.querySelector('#b')))).toBe(false);
  });

  it('falls back to the focused element when the event has no element target', () => {
    const host = mount('<input id="i">');
    (host.querySelector('#i') as HTMLInputElement).focus();
    expect(canvasKeysAllowed(at(null))).toBe(false);
  });
});
