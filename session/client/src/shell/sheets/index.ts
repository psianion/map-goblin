// The shell's own sheets. Module sheets (Room key, Token type, Party, Character, ...) register
// from their own files the same way.
import { registerSheet } from './registry';
import { ShortcutsSheet } from './ShortcutsSheet';

registerSheet({ id: 'shortcuts', Component: ShortcutsSheet });
