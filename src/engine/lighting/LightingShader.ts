/**
 * GLSL shader sources for the lighting compositing pass.
 *
 * The fragment shader samples the lighting FBO texture and blends it
 * over the scene using multiply + additive light accumulation.
 *
 * Uniforms:
 *   uLightTex   – the offscreen lighting FBO texture (TEXTURE0)
 *   uAmbient    – ambient light color as vec3 (0–1 per channel)
 */

export const LIGHTING_VERT = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;

void main(void) {
  gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vTextureCoord = aTextureCoord;
}
`

export const LIGHTING_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;

uniform sampler2D uLightTex;
uniform vec3 uAmbient;

void main(void) {
  vec4 light = texture2D(uLightTex, vTextureCoord);
  // Combine ambient with dynamic light contribution
  vec3 combined = uAmbient + light.rgb * light.a;
  // Clamp to [0,1]; alpha = 1 for the overlay sprite
  gl_FragColor = vec4(clamp(combined, 0.0, 1.0), 1.0);
}
`
