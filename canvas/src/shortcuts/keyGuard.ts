// Which keystrokes the map may answer.
//
// Canvas keys (tool letters, arrows, Delete, the Ctrl verbs) fire when the focus is on the
// page itself, on the canvas, or inside chrome marked `data-keys="canvas"` (the rail, the
// dock, the top actions, the selection card, the status bar). They never fire from a text
// field, a menu, a dialog, a tree, a listbox, a sheet, or anything editable, and a Ctrl/Cmd
// combo typed into a text field is the field's (Ctrl+X cuts text, not the label). A listbox
// that is itself marked `data-keys="canvas"` (the filmstrip) stops the keys it handles and
// hands every other one to the map.

/** Containers whose keys are their own: a focused row in one never drives the map. */
const OWN_KEYS = '[role="menu"], [role="dialog"], [role="tree"], [role="listbox"], .v2-sheet, [contenteditable="true"]';

/** Whether `el` takes typed text: an input that types, a textarea, a select, or anything editable. */
export function isTypingTarget(el: Element | null | undefined): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const h = el as HTMLElement;
  if (h.isContentEditable) return true;
  const tag = h.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = ((h as HTMLInputElement).type || 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'file', 'image'].includes(type);
}

/** The element a key event speaks for: its target, else the focused element. */
function keyTarget(e: Pick<KeyboardEvent, 'target'>): Element | null {
  const t = e.target as Element | null;
  if (t && typeof (t as HTMLElement).tagName === 'string') return t;
  return typeof document !== 'undefined' ? document.activeElement : null;
}

/** Whether the map may answer this key event at all. */
export function canvasKeysAllowed(e: Pick<KeyboardEvent, 'target'>): boolean {
  const el = keyTarget(e);
  if (!el || typeof document === 'undefined') return true;
  if (el === document.body || el === document.documentElement) return true;
  if (isTypingTarget(el)) return false;
  const own = el.closest?.(OWN_KEYS);
  if (own && own.getAttribute('data-keys') !== 'canvas') return false;
  if (el.tagName.toLowerCase() === 'canvas') return true;
  return !!el.closest?.('[data-keys="canvas"]');
}
