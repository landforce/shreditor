import { create } from 'zustand'
import type { Scorecard } from '@formats/scorecard.mjs'

const SHOW_RANGES_KEY = 'editor:formatRangesOnTimeline'

function readShowRanges(): boolean {
  try {
    return localStorage.getItem(SHOW_RANGES_KEY) !== 'false'
  } catch {
    return true
  }
}

interface FormatScorecardState {
  /** The live scorecard of the open project's timeline; null without a format. */
  card: Scorecard | null
  /** True while the scorecard reflects a timeline other than Main (inside a composition). */
  stale: boolean
  /** Mark failing ranges on the timeline ruler. */
  showTimelineRanges: boolean
  setCard: (card: Scorecard | null, stale?: boolean) => void
  setShowTimelineRanges: (show: boolean) => void
}

/**
 * The editor's live format scorecard, computed by the editor's scorecard
 * controller and read by the format panel, the toolbar chip and the timeline
 * ruler overlay.
 */
export const useFormatScorecardStore = create<FormatScorecardState>()((set) => ({
  card: null,
  stale: false,
  showTimelineRanges: readShowRanges(),
  setCard: (card, stale = false) => set({ card, stale }),
  setShowTimelineRanges: (show) => {
    try {
      localStorage.setItem(SHOW_RANGES_KEY, String(show))
    } catch {
      /* per-device preference only */
    }
    set({ showTimelineRanges: show })
  },
}))
