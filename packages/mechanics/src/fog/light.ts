// S3 P3 §2 — what is burning in a scene right now, as one rule both sides run.
//
// The referee redacts by it and the canvas masks by it, so it cannot be two implementations
// that happen to agree: the server hands in the map's light children and the client hands in
// the ones its (redacted) document holds, and everything after that — which lights are on,
// which tokens are carrying one, how far each reaches — is decided here.
//
// Geometry is deliberately absent. A source is a point and a radius; turning that into a
// polygon is a sweep against the scene's occluders, which each side already does its own way
// (`fog/sweep.ts` server-side, `visionSight.ts` on the canvas).

/** An authored light, reduced to what the light test needs. `visible` is the map's own flag. */
export interface PlacedLight {
  id: string
  x: number
  y: number
  radius: number
  visible?: boolean
}

/** A token as the light rule reads one — `Token` satisfies this structurally. */
export interface LightCarrier {
  x: number
  y: number
  hidden: boolean
  light: { dim: number; bright: number } | null
}

/** Where a light stands and how far it reaches. Lit/unlit is binary in v1 (plan §Visibility). */
export interface LightSource {
  x: number
  y: number
  radius: number
}

/**
 * Every light source in the scene: placed lights that are on, plus token-carried ones.
 *
 * `overrides` is the table's own switch — what a trigger's `light` action wrote — and it wins
 * over the map's authored `visible`, which is the same precedence `lightSync` plays back onto
 * the canvas (`overrides[id] ?? child.visible`). A light the table has never touched burns as
 * the map authored it.
 *
 * A hidden token's light is OFF, and that one is a redaction rule rather than a lighting one:
 * a torch on a token the DM has taken off the board would draw a pool of light around a
 * position no player is allowed to know. `ponytail:` if a DM ever wants an invisible lantern,
 * that is a light child placed on the map, which is exactly the tool for it.
 *
 * A carried light does not care who claims the token — an NPC with a lantern lights the room
 * like anything else.
 *
 * ponytail: the radius is `max(dim, bright)`; bright-vs-dim is presentation only in v1. The
 * day dim light means something mechanically, this is where the two radii separate.
 *
 * ponytail: uncapped, while the *renderer* composites only the 24 sources nearest the camera
 * (`MAX_RENDERED_LIGHTS`). Past that count the mask can clear a pool the frame never draws —
 * the fog errs open, and which pool loses moves with the camera. Revisit if the P6 gate map
 * plus a full party of torchbearers crosses 24 (D3).
 */
export function lightSources(
  placed: readonly PlacedLight[],
  tokens: readonly LightCarrier[],
  overrides: Record<string, boolean>,
): LightSource[] {
  const sources: LightSource[] = []
  for (const light of placed) {
    if (overrides[light.id] ?? light.visible !== false) {
      sources.push({ x: light.x, y: light.y, radius: light.radius })
    }
  }
  for (const token of tokens) {
    if (!token.light || token.hidden) continue
    sources.push({ x: token.x, y: token.y, radius: Math.max(token.light.dim, token.light.bright) })
  }
  // A light with no reach lights nothing, and a zero-radius sweep is a polygon of nothing.
  return sources.filter((source) => source.radius > 0)
}
