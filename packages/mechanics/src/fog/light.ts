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

/** A wedge, degrees: direction 0 = east, clockwise on screen. Angle >= 360 is a full circle. */
export interface LightCone {
  angle: number
  direction: number
}

/** An authored light, reduced to what the light test needs. `visible` is the map's own flag. */
export interface PlacedLight {
  id: string
  x: number
  y: number
  /** The dim edge: where the light ends. Lit means inside it. */
  radius: number
  visible?: boolean
  cone?: LightCone
  /** Swept against no walls. */
  throughWalls?: boolean
  /** Burns only while `min <= darkness <= max`. */
  nightOnly?: { min: number; max: number }
  /** A darkness source: subtracts light, blocks sight at its edge. */
  darkness?: boolean
  /** Darkness sources only: darkvision sees through it. */
  darkvisionSees?: boolean
}

/** A token as the light rule reads one — `Token` satisfies this structurally. */
export interface LightCarrier {
  x: number
  y: number
  hidden: boolean
  light: { dim: number; bright: number; angle?: number } | null
}

/** A token light's `angle` as a cone, or none for a full circle (0 and >= 360 both read as full). */
export function carriedCone(angle: number | undefined): LightCone | undefined {
  return angle !== undefined && angle > 0 && angle < 360 ? { angle, direction: 0 } : undefined
}

/** Where a light stands and how far it reaches. Lit/unlit is binary: inside the dim edge is lit. */
export interface LightSource {
  x: number
  y: number
  radius: number
  cone?: LightCone
  throughWalls?: boolean
  /** A darkness source rather than a light (see `PlacedLight.darkness`). */
  darkness?: boolean
  darkvisionSees?: boolean
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
 * The radius is the dim edge (`max(dim, bright)` for a carried light): dim light reveals ground
 * like bright does, it is only drawn dimmer.
 *
 * Darkness sources come back in the same list, flagged, so each side splits them off the way
 * it sweeps them. `darkness` is the sky's 0..1 darkness: a night-only light outside its window
 * is out. Uncapped, like the renderer since the Lighting pass: the mask and the picture read
 * the same light set.
 */
export function lightSources(
  placed: readonly PlacedLight[],
  tokens: readonly LightCarrier[],
  overrides: Record<string, boolean>,
  darkness = 1,
): LightSource[] {
  const sources: LightSource[] = []
  for (const light of placed) {
    if (!(overrides[light.id] ?? light.visible !== false)) continue
    const window = light.nightOnly
    if (window && (darkness < window.min || darkness > window.max)) continue
    sources.push({
      x: light.x,
      y: light.y,
      radius: light.radius,
      ...(light.cone && light.cone.angle < 360 ? { cone: light.cone } : {}),
      ...(light.throughWalls ? { throughWalls: true } : {}),
      ...(light.darkness ? { darkness: true } : {}),
      ...(light.darkness && light.darkvisionSees ? { darkvisionSees: true } : {}),
    })
  }
  for (const token of tokens) {
    if (!token.light || token.hidden) continue
    const cone = carriedCone(token.light.angle)
    sources.push({
      x: token.x,
      y: token.y,
      radius: Math.max(token.light.dim, token.light.bright),
      ...(cone ? { cone } : {}),
    })
  }
  // A light with no reach lights nothing, and a zero-radius sweep is a polygon of nothing.
  return sources.filter((source) => source.radius > 0)
}
