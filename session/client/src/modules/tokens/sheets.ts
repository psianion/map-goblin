// Table v2 — the play sheets in the right column (Token type, Party, Character), registered
// once from the tokens module's entry, which GameTable imports.
import { registerSheet } from '../../shell/sheets/registry';
import { CharacterSheet } from '../rolls/CharacterSheet';
import { PartySheet } from './PartySheet';
import { TokenTypeSheet } from './TokenTypeSheet';

registerSheet({ id: 'token-type', Component: TokenTypeSheet, roles: ['dm'] });
registerSheet({ id: 'party', Component: PartySheet });
registerSheet({ id: 'character', Component: CharacterSheet, roles: ['player'] });
