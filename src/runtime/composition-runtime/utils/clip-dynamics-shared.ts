import type { ResolvedAudioDynamics } from '@/types/audio'
import type { ClipDynamicsStage } from '@/infrastructure/audio/clip-dynamics/clip-dynamics-stage'

export const CLIP_DYNAMICS_PROCESSOR_NAME = 'shreditor-clip-dynamics'

export interface ClipDynamicsProcessorOptions {
  stage: ClipDynamicsStage
  dynamics: ResolvedAudioDynamics | null
  limiterInputScale: number
}

export type ClipDynamicsProcessorMessage =
  | { type: 'update'; dynamics: ResolvedAudioDynamics | null; limiterInputScale: number }
  | { type: 'dispose' }
