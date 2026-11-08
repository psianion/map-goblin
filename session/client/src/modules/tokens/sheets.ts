// Table v2 — the token sheets in the right column, registered once from the module's entry.
import { registerSheet } from '../../shell/sheets/registry';
import { PartySheet } from './PartySheet';
import { TokenTypeSheet } from './TokenTypeSheet';

registerSheet({ id: 'token-type', Component: TokenTypeSheet, roles: ['dm'] });
registerSheet({ id: 'party', Component: PartySheet });
