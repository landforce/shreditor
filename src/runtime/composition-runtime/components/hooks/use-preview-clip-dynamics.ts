import { useEffect, type RefObject } from 'react'
import type { PreviewClipAudioGraph } from '../../utils/preview-audio-graph'
import {
  setPreviewClipDynamics,
  type PreviewClipDynamicsTarget,
} from '../../utils/preview-clip-dynamics'

/**
 * Keep a clip graph's dynamics stages in sync with the clip settings.
 * `graphKey` changes whenever the component rebuilds its graph (e.g. its
 * source), so the settings are re-applied to the new graph.
 */
export function usePreviewClipDynamics(
  graphRef: RefObject<PreviewClipAudioGraph | null>,
  target: PreviewClipDynamicsTarget,
  graphKey: unknown,
): void {
  useEffect(() => {
    const graph = graphRef.current
    if (graph) setPreviewClipDynamics(graph, target)
  }, [graphRef, target, graphKey])
}
