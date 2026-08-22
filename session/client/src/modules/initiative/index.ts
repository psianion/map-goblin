// D8 — the module's single entry point: importing it registers the Initiative panel.
// GameTable imports this and learns nothing else. The turn ring (`TurnRing.ts`) mounts
// separately from GameTable itself, since it has to draw on the map whether or not this
// panel — or any panel — is open (see `mountTurnRingWhenReady`).
import './InitiativePanel';
