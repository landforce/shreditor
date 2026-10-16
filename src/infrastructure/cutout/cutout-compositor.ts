/**
 * Applies a cutout to a full source frame on the GPU (WebGL2), in source UV
 * space, in three passes:
 *
 * 1. Alpha: the two neighbouring auto-mask samples are bilinearly sampled,
 *    blended by time, feathered (Gaussian over the mask), edge-refined
 *    (smoothstep) and optionally inverted, into an alpha buffer.
 * 2. Corrections, blended into that buffer in a fixed order: smart-brush
 *    regions (max), smart-eraser regions (multiply by 1 - r), then the plain
 *    strokes as painted (brush max, eraser multiply by 1 - disc). Regions blend
 *    their own two samples by time like the auto mask.
 * 3. Output: the frame times the alpha, premultiplied. While painting, the
 *    removed area is shown dimmed and tinted instead of transparent.
 *
 * The result is a source-sized canvas the item renderer then draws with the
 * clip's own crop, transform, effects and keyframes, exactly as it would draw
 * the plain frame. Textures and the output are 8-bit unless the destination
 * itself holds more (see cutoutPrecision): then the source and the output are
 * half-float, so the pass never narrows what the clip's normal path keeps.
 */
import type { CutoutSettings } from '@/types/cutout'
import type { CutoutLayer } from './cutout-masks'

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Textures are uploaded unflipped (row 0 = top; ImageBitmaps ignore
  // UNPACK_FLIP_Y), so the top of the canvas samples v = 0.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const MASKS = `
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform float uT;
float maskAt(vec2 uv) {
  return mix(texture(uMaskA, uv).r, texture(uMaskB, uv).r, uT);
}`

const ALPHA_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${MASKS}
uniform vec2 uRadius;
uniform float uLo;
uniform float uHi;
uniform float uInvert;

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
  outColor = vec4(m);
}`

/** Most stroke points one layer draw takes (longer strokes are drawn in chunks). */
const STROKE_CHUNK = 64

const LAYER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${MASKS}
uniform int uKind;
uniform vec2 uPoints[${STROKE_CHUNK}];
uniform int uCount;
uniform float uRadius;
uniform vec2 uSize;
uniform float uErase;

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len = dot(ab, ab);
  float t = len > 0.0 ? clamp(dot(p - a, ab) / len, 0.0, 1.0) : 0.0;
  return length(p - (a + t * ab));
}

float coverage() {
  if (uKind == 0) return smoothstep(0.35, 0.65, maskAt(vUv));
  vec2 p = vUv * uSize;
  float d = 1e9;
  for (int i = 0; i < ${STROKE_CHUNK}; i++) {
    if (i >= uCount) break;
    d = min(d, segmentDistance(p, uPoints[i] * uSize, uPoints[min(i + 1, uCount - 1)] * uSize));
  }
  return 1.0 - smoothstep(uRadius - 1.0, uRadius + 1.0, d);
}

void main() {
  float c = coverage();
  outColor = vec4(uErase > 0.5 ? 1.0 - c : c);
}`

const OUTPUT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler2D uAlpha;
uniform float uHighlight;

void main() {
  // The alpha buffer was rendered bottom-up (framebuffer rows), the frame top-down.
  float m = texture(uAlpha, vec2(vUv.x, 1.0 - vUv.y)).r;
  vec4 c = texture(uSrc, vUv);
  if (uHighlight > 0.5) {
    vec3 removed = mix(c.rgb * 0.35, vec3(0.95, 0.2, 0.3), 0.35);
    outColor = vec4(mix(removed, c.rgb, m) * c.a, c.a);
    return;
  }
  float a = c.a * m;
  outColor = vec4(c.rgb * a, a);
}`

/** 8-bit, or half-float for destinations that hold more than 8 bits. */
export type CutoutPrecision = 'unorm8' | 'float16'

/**
 * The precision of the cutout pass: half-float only when the destination
 * canvas keeps more than 8 bits (a float16 2D canvas) and this WebGL2 can
 * render to half-float textures and size its drawing buffer as RGBA16F.
 * Otherwise 8-bit, which is all an 8-bit destination can show anyway.
 */
export function cutoutPrecision(input: {
  destinationColorType?: string | null
  floatRenderable: boolean
  floatDrawingBuffer: boolean
}): CutoutPrecision {
  const wide = input.destinationColorType === 'float16'
  return wide && input.floatRenderable && input.floatDrawingBuffer ? 'float16' : 'unorm8'
}

/** The texImage2D formats for a precision: [internal format, format, type]. */
export function cutoutTextureFormat(
  gl: Pick<WebGL2RenderingContext, 'RGBA' | 'RGBA8' | 'RGBA16F' | 'UNSIGNED_BYTE' | 'HALF_FLOAT'>,
  precision: CutoutPrecision,
): [number, number, number] {
  return precision === 'float16'
    ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT]
    : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE]
}

/** Corrections in compositing order: smart-brush regions, smart-eraser regions, then plain strokes as painted. */
export function orderCutoutLayers(layers: readonly CutoutLayer[]): CutoutLayer[] {
  const rank = (layer: CutoutLayer) => (layer.kind === 'stroke' ? 2 : layer.erase ? 1 : 0)
  return layers
    .map((layer, i) => ({ layer, i }))
    .sort((a, b) => rank(a.layer) - rank(b.layer) || a.i - b.i)
    .map(({ layer }) => layer)
}

/** How a correction blends into the alpha buffer: add keeps the max, erase multiplies. */
export function cutoutLayerBlend(
  gl: Pick<WebGL2RenderingContext, 'MAX' | 'FUNC_ADD' | 'ONE' | 'ZERO' | 'SRC_COLOR'>,
  erase: boolean,
): { equation: number; src: number; dst: number } {
  return erase
    ? { equation: gl.FUNC_ADD, src: gl.ZERO, dst: gl.SRC_COLOR }
    : { equation: gl.MAX, src: gl.ONE, dst: gl.ONE }
}

/** Split a stroke into overlapping chunks the layer shader takes in one draw. */
export function strokeChunks(
  points: ReadonlyArray<[number, number]>,
): Array<Array<[number, number]>> {
  if (points.length <= STROKE_CHUNK) return [points.slice()]
  const out: Array<Array<[number, number]>> = []
  for (let i = 0; i < points.length - 1; i += STROKE_CHUNK - 1) {
    out.push(points.slice(i, i + STROKE_CHUNK))
  }
  return out
}

/** WebGL2 with drawingBufferStorage (Chrome 122+), which sizes the canvas as RGBA16F. */
type WideGl = WebGL2RenderingContext & {
  drawingBufferStorage?: (format: number, width: number, height: number) => void
}

type Programs = Record<'alpha' | 'layer' | 'output', WebGLProgram>

interface GlState {
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  programs: Programs
  /** src, maskA, maskB, alpha buffer */
  textures: [WebGLTexture, WebGLTexture, WebGLTexture, WebGLTexture]
  framebuffer: WebGLFramebuffer
  floatRenderable: boolean
  locations: Map<string, WebGLUniformLocation | null>
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

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('cutout: createProgram failed')
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment))
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`cutout: program link failed: ${gl.getProgramInfoLog(program)}`)
  }
  return program
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('cutout: createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
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
  const programs = {
    alpha: link(gl, ALPHA_FRAGMENT),
    layer: link(gl, LAYER_FRAGMENT),
    output: link(gl, OUTPUT_FRAGMENT),
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const textures = [0, 1, 2, 3].map(() => makeTexture(gl)) as GlState['textures']
  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) return null
  canvas.addEventListener('contextlost', () => {
    state = null
  })
  const floatRenderable = gl.getExtension('EXT_color_buffer_float') !== null
  return { canvas, gl, programs, textures, framebuffer, floatRenderable, locations: new Map() }
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
  /** Brush corrections (any order; they are composited in cutout order). */
  layers?: readonly CutoutLayer[]
  /** Show the removed area dimmed instead of transparent (while painting). */
  highlight?: boolean
  /** The color type of the canvas the result is drawn into ('float16' keeps more than 8 bits). */
  destinationColorType?: string | null
}

type Uniform = (name: string) => WebGLUniformLocation | null

function uniforms(s: GlState, program: WebGLProgram, key: string): Uniform {
  s.gl.useProgram(program)
  return (name) => {
    const id = `${key}.${name}`
    if (!s.locations.has(id)) s.locations.set(id, s.gl.getUniformLocation(program, name))
    return s.locations.get(id)!
  }
}

function upload(s: GlState, unit: number, image: TexImageSource, precision: CutoutPrecision) {
  const { gl } = s
  const [internal, format, type] = cutoutTextureFormat(gl, precision)
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, s.textures[unit]!)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, type, image)
}

function bindSamplers(s: GlState, u: Uniform, names: Record<string, number>) {
  for (const [name, unit] of Object.entries(names)) s.gl.uniform1i(u(name), unit)
}

/** Pass 1: the auto mask's alpha into the alpha buffer (no blending). */
function drawAlpha(s: GlState, masks: [TexImageSource, TexImageSource], params: CutoutDrawParams) {
  const { gl } = s
  const u = uniforms(s, s.programs.alpha, 'alpha')
  upload(s, 1, masks[0], 'unorm8')
  upload(s, 2, masks[1], 'unorm8')
  bindSamplers(s, u, { uMaskA: 1, uMaskB: 2 })
  const feather = Math.max(0, params.settings.feather ?? 0)
  const [lo, hi] = refineBounds(params.settings.refine)
  gl.uniform1f(u('uT'), Math.min(1, Math.max(0, params.t)))
  gl.uniform2f(
    u('uRadius'),
    feather / Math.max(1, params.sourceWidth),
    feather / Math.max(1, params.sourceHeight),
  )
  gl.uniform1f(u('uLo'), lo)
  gl.uniform1f(u('uHi'), hi)
  gl.uniform1f(u('uInvert'), params.settings.invert ? 1 : 0)
  gl.disable(gl.BLEND)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

/** Pass 2: one correction blended into the alpha buffer. */
function drawLayer(s: GlState, layer: CutoutLayer, width: number, height: number) {
  const { gl } = s
  const u = uniforms(s, s.programs.layer, 'layer')
  const blend = cutoutLayerBlend(gl, layer.erase)
  gl.enable(gl.BLEND)
  gl.blendEquation(blend.equation)
  gl.blendFunc(blend.src, blend.dst)
  gl.uniform1f(u('uErase'), layer.erase ? 1 : 0)
  if (layer.kind === 'region') {
    upload(s, 1, layer.a, 'unorm8')
    upload(s, 2, layer.b, 'unorm8')
    bindSamplers(s, u, { uMaskA: 1, uMaskB: 2 })
    gl.uniform1i(u('uKind'), 0)
    gl.uniform1f(u('uT'), layer.t)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return
  }
  gl.uniform1i(u('uKind'), 1)
  gl.uniform2f(u('uSize'), width, height)
  gl.uniform1f(u('uRadius'), layer.size * Math.min(width, height))
  for (const chunk of strokeChunks(layer.points)) {
    gl.uniform2fv(u('uPoints'), chunk.flat())
    gl.uniform1i(u('uCount'), chunk.length)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}

/** Size the alpha buffer and the drawing buffer for this frame. */
function prepare(s: GlState, width: number, height: number, precision: CutoutPrecision) {
  const { gl, canvas } = s
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  if (precision === 'float16') (gl as WideGl).drawingBufferStorage?.(gl.RGBA16F, width, height)
  gl.viewport(0, 0, width, height)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.activeTexture(gl.TEXTURE3)
  gl.bindTexture(gl.TEXTURE_2D, s.textures[3])
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.textures[3], 0)
}

/** Pass 3: the frame times the alpha, to the canvas. */
function drawOutput(
  s: GlState,
  source: TexImageSource,
  precision: CutoutPrecision,
  highlight: boolean,
) {
  const { gl } = s
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.disable(gl.BLEND)
  const u = uniforms(s, s.programs.output, 'output')
  upload(s, 0, source, precision)
  bindSamplers(s, u, { uSrc: 0, uAlpha: 3 })
  gl.uniform1f(u('uHighlight'), highlight ? 1 : 0)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

function precisionFor(s: GlState, params: CutoutDrawParams): CutoutPrecision {
  return cutoutPrecision({
    destinationColorType: params.destinationColorType,
    floatRenderable: s.floatRenderable,
    floatDrawingBuffer: typeof (s.gl as WideGl).drawingBufferStorage === 'function',
  })
}

/**
 * The frame with the cutout applied, as a canvas of the frame's size (valid
 * until the next call), or null when WebGL2 is unavailable.
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
  if (s.gl.isContextLost()) {
    state = null
    return null
  }
  const precision = precisionFor(s, params)
  prepare(s, width, height, precision)
  drawAlpha(s, [maskA, maskB], params)
  for (const layer of orderCutoutLayers(params.layers ?? [])) drawLayer(s, layer, width, height)
  drawOutput(s, source, precision, params.highlight === true)
  return s.canvas
}
