/**
 * The `addLut` edit op's effect: a `gpu-lut` built from a `.cube` file in the
 * workspace LUT library. The Node side (headless/lib/luts.mjs) resolves the
 * op's `lut` name inside `<workspace>/luts/` and passes the file's text in the
 * edit input; this embeds it exactly as the editor's LUT panel does.
 */
import type { VisualEffect } from '@/types/effects'
import { embedCubeLut, type EmbeddedLutParams } from '@/infrastructure/gpu-effects/lut/cube-lut'

/** A library LUT's text, read by the Node side for an `addLut` op. */
export interface HeadlessLutFile {
  /** File name in `luts/`, as the op names it. */
  name: string
  text: string
}

function lutText(name: string, luts: readonly HeadlessLutFile[]): string {
  const file = luts.find((candidate) => candidate.name === name)
  if (file) return file.text
  const have = luts.map((candidate) => candidate.name).join(', ') || 'none'
  throw new Error(
    `lut: "${name}" was not provided with the edit (the service reads it from the workspace luts/ folder; provided: ${have})`,
  )
}

function lutIntensity(value: unknown): number {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('intensity: must be between 0 and 1')
  return value
}

function embedLibraryLut(name: string, text: string): EmbeddedLutParams {
  try {
    return embedCubeLut(text, name)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`lut: luts/${name} is not a usable 3D LUT: ${reason}`)
  }
}

/** The gpu-lut effect for `{ op: 'addLut', lut, intensity? }`. Throws on a bad op or LUT. */
export function buildLutEffect(
  op: Readonly<Record<string, unknown>>,
  luts: readonly HeadlessLutFile[],
): VisualEffect {
  if (typeof op.lut !== 'string' || !op.lut) throw new Error('addLut requires `lut`')
  const intensity = lutIntensity(op.intensity)
  const embedded = embedLibraryLut(op.lut, lutText(op.lut, luts))
  return { type: 'gpu-effect', gpuEffectType: 'gpu-lut', params: { ...embedded, intensity } }
}
