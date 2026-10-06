/**
 * Single import seam for motion-templates -> timeline dependencies.
 */
export {
  discardUnusedTemplateCompositions,
  ensureMotionTemplateComposition,
  insertMotionTemplate,
  updateMotionTemplate,
  type InsertMotionTemplateResult,
} from '@/features/timeline/stores/actions/motion-template-actions'
export {
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
} from '@/features/timeline/stores/actions/shared'
export {
  buildSubCompositionInput,
  importCanvasRenderOrchestrator,
  resolveMediaUrl,
  resolveMediaUrls,
  useCompositionsStore,
  type SubComposition,
} from '@/features/timeline/contracts/media-library'
