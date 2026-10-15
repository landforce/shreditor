/**
 * Applies a cutout mask to a full source frame on the GPU (WebGL2): the two
 * neighbouring mask samples are bilinearly sampled in source UV space, blended
 * by time, feathered (Gaussian over the mask), edge-refined (smoothstep), and
 * optionally inverted, then multiplied into the frame's alpha. The result is a
 * source-sized, premultiplied RGBA canvas that the item renderer then draws
 * with the clip's own crop, transform, effects and keyframes, exactly as it
 * would draw the plain frame.
 */
import type { CutoutSettings } from '@/types/cutout'

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform float uT;
uniform vec2 uRadius;
uniform float uLo;
uniform float uHi;
uniform float uInvert;

float maskAt(vec2 uv) {
  return mix(texture(uMaskA, uv).r, texture(uMaskB, uv).r, uT);
}

void main() {
  float m;
  if (uRadius.x > 0.0 || uRadius.y > 0.0) {
    float sum = 0.0;
    float weights = 0.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        vec2 k = vec2(float(x), float(y));
        float w = exp(-dot(k, k) / 4.5);
        sum += maskAt(clamp(vUv + k / 3.0 * uRadius, 0.0, 1.0)) * w;
        weights += w;
      }
    }
    m = sum / weights;
  } else {
    m = maskAt(vUv);
  }
  m = smoothstep(uLo, uHi, m);
  if (uInvert > 0.5) m = 1.0 - m;
  vec4 c = texture(uSrc, vUv);
  float a = c.a * m;
  outColor = vec4(c.rgb * a, a);
}`

interface GlState {
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  program: WebGLProgram
  textures: [WebGLTexture, WebGLTexture, WebGLTexture]
  uniforms: Record<string, WebGLUniformLocation | null>
}

let state: GlState | null = null
let unavailable = false

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('cutout: createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`cutout: shader compile failed: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

function createState(): GlState | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  const canvas = new OffscreenCanvas(16, 16)
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`cutout: program link failed: ${gl.getProgramInfoLog(program)}`)
  }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const makeTexture = (unit: number, name: string) => {
    const texture = gl.createTexture()
    if (!texture) throw new Error('cutout: createTexture failed')
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gl.getUniformLocation(program, name), unit)
    return texture
  }
  const textures: GlState['textures'] = [
    makeTexture(0, 'uSrc'),
    makeTexture(1, 'uMaskA'),
    makeTexture(2, 'uMaskB'),
  ]
  const uniforms = Object.fromEntries(
    ['uT', 'uRadius', 'uLo', 'uHi', 'uInvert'].map((name) => [
      name,
      gl.getUniformLocation(program, name),
    ]),
  )
  canvas.addEventListener('contextlost', () => {
    state = null
  })
  return { canvas, gl, program, textures, uniforms }
}

function getState(): GlState | null {
  if (state || unavailable) return state
  try {
    state = createState()
  } catch {
    state = null
  }
  if (!state) unavailable = true
  return state
}

/** Edge refinement as smoothstep bounds: 0 keeps the soft matte, 1 is a hard edge at 0.5. */
export function refineBounds(refine: number | undefined): [number, number] {
  const r = Math.min(1, Math.max(0, refine ?? 0))
  const half = Math.max(0.01, 0.5 * (1 - r))
  return [0.5 - half, 0.5 + half]
}

export interface CutoutDrawParams {
  t: number
  settings: Pick<CutoutSettings, 'feather' | 'invert' | 'refine'>
  /** The source frame's full size, which `feather` (source pixels) is measured against. */
  sourceWidth: number
  sourceHeight: number
}

/**
 * The frame with the mask applied, as a canvas of the frame's size (valid until
 * the next call), or null when WebGL2 is unavailable.
 */
export function applyCutoutMask(
  source: TexImageSource,
  width: number,
  height: number,
  maskA: TexImageSource,
  maskB: TexImageSource,
  params: CutoutDrawParams,
): OffscreenCanvas | null {
  const s = getState()
  if (!s) return null
  const { gl, canvas, textures, uniforms } = s
  if (gl.isContextLost()) {
    state = null
    return null
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  gl.viewport(0, 0, width, height)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  const upload = (unit: number, image: TexImageSource) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, textures[unit]!)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }
  upload(0, source)
  upload(1, maskA)
  upload(2, maskB)
  const feather = Math.max(0, params.settings.feather ?? 0)
  const [lo, hi] = refineBounds(params.settings.refine)
  gl.uniform1f(uniforms.uT ?? null, Math.min(1, Math.max(0, params.t)))
  gl.uniform2f(
    uniforms.uRadius ?? null,
    feather / Math.max(1, params.sourceWidth),
    feather / Math.max(1, params.sourceHeight),
  )
  gl.uniform1f(uniforms.uLo ?? null, lo)
  gl.uniform1f(uniforms.uHi ?? null, hi)
  gl.uniform1f(uniforms.uInvert ?? null, params.settings.invert ? 1 : 0)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  return canvas
}
