// The smart brush's model, SlimSAM-77 (a pruned Segment Anything), and the pure
// maths around it: input sizing and normalisation, prompt coordinates, picking
// a candidate mask, IoU, interior points to re-prompt the next frame with, and
// a region's centroid and bounding box. Shared by the editor's worker, the
// headless harness and the tests (docs/background-removal.md, Smart brush).
//
// The ONNX export has two graphs: a vision encoder (1024² input, run once per
// frame) and a prompt encoder + mask decoder (points in, three candidate masks
// at 256² and their predicted IoU out, run per prompt).

/** Encoder input edge, in pixels (the frame is resized to fit and padded). */
export const SAM_INPUT_EDGE = 1024
/** Edge of the decoder's low-resolution masks (covering the padded input). */
const SAM_MASK_EDGE = 256
/** Most points one prompt carries. */
export const SAM_MAX_POINTS = 16
/** Tracking stops when the best candidate overlaps the previous region less than this. */
export const SAM_MIN_TRACK_IOU = 0.25

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/**
 * SlimSAM-77 (Apache-2.0, code and weights), pinned to a Hugging Face commit.
 * The encoder runs fp32 on WebGPU and the int8 quantisation on wasm; the small
 * decoder always runs the int8 one on wasm.
 */
export const CUTOUT_SAM_MODEL = {
  id: 'slimsam',
  label: 'SlimSAM-77',
  license: 'Apache-2.0',
  repo: 'Xenova/slimsam-77-uniform',
  revision: '5850ab45f587c112167512ffef949107115e26a0',
  files: {
    encoder: {
      webgpu: {
        path: 'onnx/vision_encoder.onnx',
        bytes: 23276014,
        sha256: '9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0',
      },
      wasm: {
        path: 'onnx/vision_encoder_quantized.onnx',
        bytes: 8882165,
        sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971',
      },
    },
    decoder: {
      wasm: {
        path: 'onnx/prompt_encoder_mask_decoder_quantized.onnx',
        bytes: 4903810,
        sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2',
      },
    },
  },
}

/** One SlimSAM file: `part` encoder or decoder, for a backend (the decoder has wasm only). */
export function samModelFile(part, backend) {
  const files = CUTOUT_SAM_MODEL.files[part]
  return files[backend] ?? files.wasm
}

/** Pinned download URL of a SlimSAM file. */
export function samModelUrl(part, backend) {
  const { repo, revision } = CUTOUT_SAM_MODEL
  return `https://huggingface.co/${repo}/resolve/${revision}/${samModelFile(part, backend).path}`
}

/** The name a SlimSAM file is cached under on disk (the headless model cache). */
export function samModelFileName(part, backend) {
  return `slimsam-${part}-${samModelFile(part, backend).sha256.slice(0, 12)}.onnx`
}

// ---------------------------------------------------------------------------
// Encoder input

/** The frame size the encoder sees: the long edge at 1024, the rest padded. */
export function samResizedSize(width, height) {
  const scale = SAM_INPUT_EDGE / Math.max(1, width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** RGBA at the resized size → normalised planar RGB, zero-padded to 1024². */
export function samPixelValues(rgba, width, height) {
  const edge = SAM_INPUT_EDGE
  const plane = edge * edge
  const out = new Float32Array(plane * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * edge + x
      for (let c = 0; c < 3; c++) out[c * plane + dst] = (rgba[src + c] / 255 - MEAN[c]) / STD[c]
    }
  }
  return out
}

/** Prompt points (source fractions) → flat [x, y, ...] in resized-input pixels. */
export function samPromptCoords(points, resized) {
  const out = new Float32Array(points.length * 2)
  points.forEach(([x, y], i) => {
    out[i * 2] = x * resized.width
    out[i * 2 + 1] = y * resized.height
  })
  return out
}

/** The part of the 256² decoder mask that covers the frame (the rest is padding). */
export function samMaskSize(resized) {
  const scale = SAM_MASK_EDGE / SAM_INPUT_EDGE
  return {
    width: Math.max(1, Math.ceil(resized.width * scale)),
    height: Math.max(1, Math.ceil(resized.height * scale)),
  }
}

/**
 * Candidate `index` of the decoder's logits ([3, 256, 256] flat) as region
 * probabilities (0..1) cropped to the frame: `size` from samMaskSize.
 */
export function samCandidate(logits, index, size) {
  const edge = SAM_MASK_EDGE
  const offset = index * edge * edge
  const out = new Float32Array(size.width * size.height)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      out[y * size.width + x] = 1 / (1 + Math.exp(-logits[offset + y * edge + x]))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Regions

/** Intersection over union of two same-sized region masks, thresholded at 0.5. */
export function maskIoU(a, b) {
  let inter = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0.5
    const y = b[i] > 0.5
    if (x && y) inter++
    if (x || y) union++
  }
  return union === 0 ? 0 : inter / union
}

/**
 * Which candidate to keep: the one that overlaps `reference` most (the painted
 * stroke on its own frame, the previous region while tracking), the decoder's
 * own score breaking ties. Without a reference, the best-scored one. Returns
 * { index, iou } (iou against the reference, else the score).
 */
export function pickSamCandidate(candidates, scores, reference) {
  let best = { index: 0, iou: -1, score: -1 }
  candidates.forEach((mask, index) => {
    const iou = reference ? maskIoU(mask, reference) : scores[index]
    if (iou > best.iou || (iou === best.iou && scores[index] > best.score))
      best = { index, iou, score: scores[index] }
  })
  return { index: best.index, iou: best.iou }
}

/** Chamfer (3-4) distance from each inside pixel to the nearest outside one. */
function insideDistance(mask, width, height) {
  const big = 1e9
  const d = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) d[i] = mask[i] > 0.5 ? big : 0
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x])
  const relax = (i, x, y, steps) => {
    for (const [dx, dy, w] of steps) d[i] = Math.min(d[i], at(x + dx, y + dy) + w)
  }
  const forward = [[-1, 0, 3], [0, -1, 3], [-1, -1, 4], [1, -1, 4]]
  const backward = [[1, 0, 3], [0, 1, 3], [1, 1, 4], [-1, 1, 4]]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (d[y * width + x]) relax(y * width + x, x, y, forward)
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) if (d[y * width + x]) relax(y * width + x, x, y, backward)
  return d
}

/**
 * Up to `max` points well inside a region (as source fractions), spread out:
 * the deepest pixels first, each at least ~half the region's depth from the
 * others. They prompt the next frame while tracking.
 */
export function interiorPoints(mask, width, height, max = 8) {
  const depth = insideDistance(mask, width, height)
  const order = [...depth.keys()].filter((i) => depth[i] > 0).sort((a, b) => depth[b] - depth[a])
  if (order.length === 0) return []
  const spacing = Math.max(2, (depth[order[0]] / 3) * 0.6)
  const picked = []
  for (const i of order) {
    const x = i % width
    const y = Math.floor(i / width)
    if (picked.every(([px, py]) => Math.hypot(px - x, py - y) >= spacing)) picked.push([x, y])
    if (picked.length >= max) break
  }
  return picked.map(([x, y]) => [(x + 0.5) / width, (y + 0.5) / height])
}

/**
 * A region's centroid, bounding box and area, as fractions of the frame:
 * [cx, cy, x0, y0, x1, y1, area], or null when it is empty. Plain strokes
 * inside the box follow the centroid (cutout-strokes.mjs).
 */
export function regionStats(mask, width, height) {
  let n = 0
  let sx = 0
  let sy = 0
  const box = [width, height, -1, -1]
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] <= 0.5) continue
    const x = i % width
    const y = Math.floor(i / width)
    n++
    sx += x
    sy += y
    box[0] = Math.min(box[0], x)
    box[1] = Math.min(box[1], y)
    box[2] = Math.max(box[2], x)
    box[3] = Math.max(box[3], y)
  }
  if (n === 0) return null
  const round = (v) => Math.round(v * 1e4) / 1e4
  return [
    round((sx / n + 0.5) / width),
    round((sy / n + 0.5) / height),
    round(box[0] / width),
    round(box[1] / height),
    round((box[2] + 1) / width),
    round((box[3] + 1) / height),
    round(n / mask.length),
  ]
}
