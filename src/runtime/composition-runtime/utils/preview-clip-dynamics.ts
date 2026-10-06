/**
 * Inserts the clip dynamics worklet nodes into a preview clip graph:
 *
 *   source -> [denoise] -> EQ stages -> [compressor/de-esser] -> clip gain -> [limiter] -> out
 *
 * Nodes exist only while their stage is enabled. The worklet module loads
 * asynchronously the first time a stage is needed; the stage is wired in as
 * soon as it is ready.
 */
import type { ResolvedAudioDynamics } from '@/types/audio'
import { areAudioDynamicsEqual } from '@/shared/utils/audio-dynamics'
import {
  isClipDynamicsStageActive,
  type ClipDynamicsStage,
} from '@/infrastructure/audio/clip-dynamics/clip-dynamics-stage'
import {
  createClipDynamicsNode,
  ensureClipDynamicsWorkletLoaded,
  isClipDynamicsWorkletReady,
  postClipDynamicsMessage,
} from './clip-dynamics-worklet'

const STAGES: readonly ClipDynamicsStage[] = ['denoise', 'dynamics', 'limiter']

/** What a clip asks of its dynamics stages (see `setPreviewClipDynamics`). */
export interface PreviewClipDynamicsTarget {
  dynamics: ResolvedAudioDynamics | null
  limiterInputScale: number
}

export interface PreviewClipDynamicsState {
  nodes: Record<ClipDynamicsStage, AudioWorkletNode | null>
  dynamics: ResolvedAudioDynamics | null
  limiterInputScale: number
  disposed: boolean
}

/** The graph nodes each stage sits between. */
interface PreviewClipDynamicsHost {
  context: BaseAudioContext
  sourceInputNode: AudioNode
  eqInputNode: AudioNode
  eqOutputNode: AudioNode
  outputGainNode: AudioNode
  dynamicsState: PreviewClipDynamicsState
}

export function createPreviewClipDynamicsState(): PreviewClipDynamicsState {
  return {
    nodes: { denoise: null, dynamics: null, limiter: null },
    dynamics: null,
    limiterInputScale: 1,
    disposed: false,
  }
}

function stageEndpoints(host: PreviewClipDynamicsHost, stage: ClipDynamicsStage) {
  if (stage === 'denoise') return { from: host.sourceInputNode, to: host.eqInputNode }
  if (stage === 'dynamics') return { from: host.eqOutputNode, to: host.outputGainNode }
  return { from: host.outputGainNode, to: host.context.destination }
}

function wireStage(
  host: PreviewClipDynamicsHost,
  stage: ClipDynamicsStage,
  node: AudioWorkletNode | null,
): void {
  const { from, to } = stageEndpoints(host, stage)
  from.disconnect()
  host.dynamicsState.nodes[stage]?.disconnect()
  if (node) {
    from.connect(node)
    node.connect(to)
  } else {
    from.connect(to)
  }
  host.dynamicsState.nodes[stage] = node
}

/** Connect the pass-through wiring between the fixed graph nodes (no stages yet). */
export function connectPreviewClipDynamicsBypass(host: PreviewClipDynamicsHost): void {
  for (const stage of STAGES) wireStage(host, stage, null)
}

function removeStage(host: PreviewClipDynamicsHost, stage: ClipDynamicsStage): void {
  const node = host.dynamicsState.nodes[stage]
  if (!node) return
  wireStage(host, stage, null)
  postClipDynamicsMessage(node, { type: 'dispose' })
}

function syncStages(host: PreviewClipDynamicsHost): void {
  const state = host.dynamicsState
  if (state.disposed) return
  let waitingForModule = false
  for (const stage of STAGES) {
    const node = state.nodes[stage]
    if (!isClipDynamicsStageActive(stage, state.dynamics)) {
      removeStage(host, stage)
    } else if (node) {
      postClipDynamicsMessage(node, {
        type: 'update',
        dynamics: state.dynamics,
        limiterInputScale: state.limiterInputScale,
      })
    } else if (isClipDynamicsWorkletReady(host.context)) {
      const options = {
        stage,
        dynamics: state.dynamics,
        limiterInputScale: state.limiterInputScale,
      }
      wireStage(host, stage, createClipDynamicsNode(host.context, options))
    } else {
      waitingForModule = true
    }
  }
  if (waitingForModule) {
    void ensureClipDynamicsWorkletLoaded(host.context).then((loaded) => {
      if (loaded) syncStages(host)
    })
  }
}

/**
 * Apply a clip's dynamics. `limiterInputScale` is the gain the preview applies
 * before the limiter that export applies after it (master bus x monitor
 * volume); the limiter's ceiling follows it so limiting matches export.
 */
export function setPreviewClipDynamics(
  host: PreviewClipDynamicsHost,
  { dynamics, limiterInputScale }: PreviewClipDynamicsTarget,
): void {
  const state = host.dynamicsState
  if (
    areAudioDynamicsEqual(state.dynamics, dynamics) &&
    state.limiterInputScale === limiterInputScale
  ) {
    return
  }
  state.dynamics = dynamics
  state.limiterInputScale = limiterInputScale
  syncStages(host)
}

export function disposePreviewClipDynamics(host: PreviewClipDynamicsHost): void {
  const state = host.dynamicsState
  state.disposed = true
  for (const stage of STAGES) {
    const node = state.nodes[stage]
    if (!node) continue
    node.disconnect()
    postClipDynamicsMessage(node, { type: 'dispose' })
    state.nodes[stage] = null
  }
}
