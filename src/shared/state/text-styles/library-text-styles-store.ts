import { create } from 'zustand'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  readTextStyleLibrary,
  readTextStyleLibraryStamp,
  updateTextStyleLibrary,
  type TextStyleLibraryStamp,
} from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'

function getLog() {
  return createLogger('TextStyleLibrary')
}

/**
 * The workspace text style library (`app/text-styles.json`) as the editor
 * last read it. Never written back wholesale: each change goes through
 * `updateTextStyleLibrary`, which applies it to the file as it is on disk.
 */
interface LibraryTextStylesState {
  styles: TextStyleDefinition[]
  loaded: boolean
  stamp: TextStyleLibraryStamp | null
  /** Re-read the file when it changed since the last read (cheap otherwise). */
  refresh: (options?: { force?: boolean }) => Promise<void>
  /** Add or replace one style (matched by id). */
  saveStyle: (style: TextStyleDefinition) => Promise<void>
  removeStyle: (id: string) => Promise<void>
}

const sameStamp = (a: TextStyleLibraryStamp | null, b: TextStyleLibraryStamp | null) =>
  a?.lastModified === b?.lastModified && a?.size === b?.size

export const useLibraryTextStylesStore = create<LibraryTextStylesState>()((set, get) => {
  const write = async (change: (styles: TextStyleDefinition[]) => TextStyleDefinition[]) => {
    try {
      const styles = await updateTextStyleLibrary(change)
      set({ styles, loaded: true, stamp: await readTextStyleLibraryStamp() })
    } catch (error) {
      getLog().error('Failed to write the text style library', error)
      throw error
    }
  }

  return {
    styles: [],
    loaded: false,
    stamp: null,
    refresh: async (options) => {
      try {
        const stamp = await readTextStyleLibraryStamp()
        if (!options?.force && get().loaded && sameStamp(stamp, get().stamp)) return
        set({ styles: stamp ? await readTextStyleLibrary() : [], loaded: true, stamp })
      } catch (error) {
        getLog().warn('Failed to read the text style library', error)
      }
    },
    saveStyle: (style) =>
      write((styles) =>
        styles.some((entry) => entry.id === style.id)
          ? styles.map((entry) => (entry.id === style.id ? style : entry))
          : [...styles, style],
      ),
    removeStyle: (id) => write((styles) => styles.filter((style) => style.id !== id)),
  }
})
