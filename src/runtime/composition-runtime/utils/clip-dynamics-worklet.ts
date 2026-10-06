import { createLogger } from '@/shared/logging/logger'
import {
  CLIP_DYNAMICS_PROCESSOR_NAME,
  type ClipDynamicsProcessorMessage,
  type ClipDynamicsProcessorOptions,
} from './clip-dynamics-shared'
import workletModuleUrl from '../worklets/clip-dynamics-processor.worklet.ts?worker&url'

const log = createLogger('ClipDynamicsWorklet')
const workletLoads = new WeakMap<BaseAudioContext, Promise<boolean>>()
const loadedContexts = new WeakSet<BaseAudioContext>()

/** Whether the module is loaded, so a node can be created synchronously. */
export function isClipDynamicsWorkletReady(context: BaseAudioContext): boolean {
  return loadedContexts.has(context)
}

/** Load the clip dynamics worklet module once per context. Resolves false if unsupported. */
export function ensureClipDynamicsWorkletLoaded(context: BaseAudioContext): Promise<boolean> {
  if (typeof AudioWorkletNode === 'undefined' || !context.audioWorklet) {
    return Promise.resolve(false)
  }
  const pending = workletLoads.get(context)
  if (pending) return pending
  const load = context.audioWorklet
    .addModule(workletModuleUrl)
    .then(() => {
      loadedContexts.add(context)
      return true
    })
    .catch((error) => {
      log.warn('Failed to load clip dynamics worklet module', { error })
      workletLoads.delete(context)
      return false
    })
  workletLoads.set(context, load)
  return load
}

export function createClipDynamicsNode(
  context: BaseAudioContext,
  options: ClipDynamicsProcessorOptions,
): AudioWorkletNode {
  return new AudioWorkletNode(context, CLIP_DYNAMICS_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: options,
  })
}

export function postClipDynamicsMessage(
  node: AudioWorkletNode,
  message: ClipDynamicsProcessorMessage,
): void {
  node.port.postMessage(message)
}
