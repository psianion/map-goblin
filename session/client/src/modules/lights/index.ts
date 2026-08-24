// D8 — the module's single entry point: importing it registers the Lights panel. GameTable
// imports this and learns nothing else — `LightPopover` is the one exception, mounted directly
// by GameTable as an on-map overlay rather than a registered panel (same reason `DoorMenu` and
// `TokenMenu` are, in `doors`/`tokens`).
import './LightsPanel';
