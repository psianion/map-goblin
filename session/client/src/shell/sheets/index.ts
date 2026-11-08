// The shell's own sheets. Module sheets (Room key, Token type, Character, ...) register from
// their own files the same way; registering an id again replaces it.
import { LogSheet } from './LogSheet';
import { PartySheet } from './PartySheet';
import { registerSheet, sheetDef } from './registry';
import { ShortcutsSheet } from './ShortcutsSheet';

registerSheet({ id: 'shortcuts', Component: ShortcutsSheet });
registerSheet({ id: 'log', Component: LogSheet });
// The roster, until the play side registers the real Party sheet (whichever loads first, it wins).
if (!sheetDef('party')) registerSheet({ id: 'party', Component: PartySheet, roles: ['dm'] });
