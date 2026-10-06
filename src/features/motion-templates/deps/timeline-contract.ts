/**
 * Single import seam for motion-templates -> timeline dependencies.
 */
export {
  discardUnusedTemplateCompositions,
  ensureMotionTemplateComposition,
  insertMotionTemplate,
  syncSavedTemplateComposition,
  updateMotionTemplate,
  type InsertMotionTemplateResult,
} from '@/features/timeline/stores/actions/motion-template-actions'
export { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
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
