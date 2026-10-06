/**
 * RNNoise (xiph, BSD-3-Clause) compiled to WebAssembly by @jitsi/rnnoise-wasm
 * (Apache-2.0). The "sync" build inlines the wasm and instantiates
 * synchronously, so it works inside an AudioWorkletGlobalScope (which cannot
 * fetch) as well as on the main thread during export. Import this module
 * lazily: it carries ~1.9 MB of inlined model.
 */
import createRNNWasmModuleSync from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js'
import { DENOISE_FRAME_SIZE, type DenoiseFrameProcessor, type DenoiseModel } from './denoiser'

interface RnnoiseModule {
  HEAPF32: Float32Array
  _malloc(bytes: number): number
  _free(pointer: number): void
  _rnnoise_create(model: number): number
  _rnnoise_destroy(state: number): void
  _rnnoise_process_frame(state: number, output: number, input: number): number
}

let rnnoiseModule: RnnoiseModule | null = null

function getRnnoiseModule(): RnnoiseModule {
  rnnoiseModule ??= createRNNWasmModuleSync() as RnnoiseModule
  return rnnoiseModule
}

/** A fresh RNNoise state (one per channel) that denoises 480-sample frames in place. */
function createRnnoiseFrameProcessor(): DenoiseFrameProcessor {
  const module = getRnnoiseModule()
  const state = module._rnnoise_create(0)
  const pointer = module._malloc(DENOISE_FRAME_SIZE * Float32Array.BYTES_PER_ELEMENT)
  let disposed = false
  return {
    process(frame) {
      if (disposed) return
      // HEAPF32 is re-read every call: memory growth replaces the buffer.
      const heap = module.HEAPF32
      const offset = pointer / Float32Array.BYTES_PER_ELEMENT
      heap.set(frame, offset)
      module._rnnoise_process_frame(state, pointer, pointer)
      frame.set(module.HEAPF32.subarray(offset, offset + DENOISE_FRAME_SIZE))
    },
    dispose() {
      if (disposed) return
      disposed = true
      module._rnnoise_destroy(state)
      module._free(pointer)
    },
  }
}

/**
 * RNNoise's output frame is the input from two frames earlier (measured: the
 * output correlates 0.997 with the input delayed by 960 samples at 48 kHz).
 */
export const RNNOISE_MODEL: DenoiseModel = {
  frameDelay: 2 * DENOISE_FRAME_SIZE,
  createFrameProcessor: createRnnoiseFrameProcessor,
}
