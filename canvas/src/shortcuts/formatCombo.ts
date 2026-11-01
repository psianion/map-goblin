// How a key combo reads on screen: the shortcuts sheet, the menu captions and the tooltips.

import { shortcutById } from './defaultShortcuts';

/** Whether this is a Mac, where Ctrl reads ⌘ and Alt reads ⌥. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return /mac|iphone|ipad/i.test(hint || navigator.userAgent);
}

const KEY_NAMES: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  delete: 'Del',
  escape: 'Esc',
  ' ': 'Space',
};

/**
 * 'ctrl+shift+z' as it reads: "Ctrl Shift Z" on Windows and Linux, "⇧⌘Z" on a Mac. Single
 * keys read upper case, arrows as arrows, named keys capitalised ("Page Up", "Tab").
 */
export function formatCombo(combo: string, mac = isMac()): string {
  // The '+' key itself: 'shift++' and '+'.
  const plus = combo.endsWith('+');
  const parts = (plus ? combo.slice(0, -1) : combo).split('+').filter(Boolean);
  const key = plus ? '+' : (parts.pop() ?? '');
  const mods = new Set(parts);
  const name = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1));
  if (mac) {
    const marks = `${mods.has('alt') ? '⌥' : ''}${mods.has('shift') ? '⇧' : ''}${mods.has('ctrl') ? '⌘' : ''}`;
    return marks && name.length > 1 ? `${marks} ${name}` : `${marks}${name}`;
  }
  return [mods.has('ctrl') && 'Ctrl', mods.has('shift') && 'Shift', mods.has('alt') && 'Alt', name].filter(Boolean).join(' ');
}

/** The caption for a table entry's first key, by id ('edit.undo' reads "Ctrl Z"). */
export function keyCaption(id: string): string {
  const s = shortcutById(id);
  return s ? formatCombo(s.combo) : '';
}
