import { create } from 'zustand'
import type { TextStyleDefinition } from '@/types/text-style'

/**
 * The open project's text styles (its copies, `timeline.textStyles`).
 * Part of the timeline undo snapshot, saved with the timeline, and written
 * only through the text style actions so items stay in step with them.
 */
interface ProjectTextStylesState {
  styles: TextStyleDefinition[]
  setStyles: (styles: TextStyleDefinition[]) => void
}

const EMPTY: TextStyleDefinition[] = []

export const useProjectTextStylesStore = create<ProjectTextStylesState>()((set) => ({
  styles: EMPTY,
  setStyles: (styles) => set({ styles: styles.length > 0 ? styles : EMPTY }),
}))

/** A project style by id (undefined when the id is not in the project). */
export function getProjectTextStyle(id: string | undefined): TextStyleDefinition | undefined {
  if (!id) return undefined
  return useProjectTextStylesStore.getState().styles.find((style) => style.id === id)
}
