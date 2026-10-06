import type { MediaCategory } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'
import { autoCategoryUpdate } from '../utils/media-categories'
import { getMedia, suggestMediaCategoriesInWorkspace, updateMedia } from '../deps/storage'

const log = createLogger('CategorySuggestions')

export interface CategorySuggestion {
  mediaId: string
  category: MediaCategory
}

/**
 * Persist automatic category suggestions to each media's metadata.json.
 * Through the bridge the precedence check runs on the file itself, so an
 * explicit category written by the agent or another tab is kept. Without a
 * bridge only this tab writes metadata, so a fresh read is enough.
 *
 * Returns true when any media turned out to have an explicit category on
 * disk (the caller re-reads the media to show it).
 */
export async function persistCategorySuggestions(
  suggestions: readonly CategorySuggestion[],
): Promise<boolean> {
  if (suggestions.length === 0) return false
  const viaBridge = await suggestMediaCategoriesInWorkspace(suggestions)
  if (viaBridge) return viaBridge.kept.length > 0

  let kept = false
  for (const { mediaId, category } of suggestions) {
    const current = await getMedia(mediaId)
    if (!current) continue
    const update = autoCategoryUpdate(current, category)
    if (!update) {
      kept ||= current.category !== category
      continue
    }
    await updateMedia(mediaId, { ...update, updatedAt: Date.now() })
    log.debug('Suggested a category', { mediaId, category })
  }
  return kept
}
