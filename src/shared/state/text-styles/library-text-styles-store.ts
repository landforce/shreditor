import { create } from 'zustand'
import type { TextStyleDefinition } from '@/types/text-style'
import {
  readTextStyleLibrary,
  readTextStyleLibraryStamp,
  seedTextStyleLibrary,
  updateTextStyleLibrary,
  type TextStyleLibraryStamp,
} from '@/infrastructure/storage'
import { buildBuiltinTextStyles } from '@/shared/typography/text-styles/builtin-text-styles'
import { mergeTextStyleFamilies } from '@/shared/typography/text-styles/text-style-family.mjs'
import { createLogger } from '@/shared/logging/logger'

function getLog() {
  return createLogger('TextStyleLibrary')
}

/**
 * The workspace text style library (`app/text-styles.json`) as the editor
 * last read it. Never written back wholesale: each change goes through
 * `updateTextStyleLibrary`, which applies it to the file as it is on disk.
 * A library that was never seeded gets the built-in styles once.
 */
interface LibraryTextStylesState {
  styles: TextStyleDefinition[]
  loaded: boolean
  /** The built-in styles were added to this library (they are ordinary styles now). */
  seeded: boolean
  stamp: TextStyleLibraryStamp | null
  /** Re-read the file when it changed since the last read (cheap otherwise). */
  refresh: (options?: { force?: boolean }) => Promise<void>
  /**
   * Add a style, or lay it over the one with its id: its variants replace
   * those for the same aspects, the library's other variants stay.
   */
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

  /** Seed at most once per file state, so a failing write is not retried every poll. */
  let seedTriedFor: string | undefined
  const seedOnce = async (stamp: TextStyleLibraryStamp | null): Promise<boolean> => {
    const key = JSON.stringify(stamp)
    if (seedTriedFor === key) return false
    seedTriedFor = key
    try {
      return (await seedTextStyleLibrary(buildBuiltinTextStyles())) !== null
    } catch (error) {
      getLog().warn('Could not add the built-in text styles to the library', error)
      return false
    }
  }

  return {
    styles: [],
    loaded: false,
    seeded: false,
    stamp: null,
    refresh: async (options) => {
      try {
        let stamp = await readTextStyleLibraryStamp()
        if (!options?.force && get().loaded && sameStamp(stamp, get().stamp)) return
        let library = stamp ? await readTextStyleLibrary() : { styles: [], seeded: false }
        if (!library.seeded && (await seedOnce(stamp))) {
          stamp = await readTextStyleLibraryStamp()
          library = await readTextStyleLibrary()
        }
        set({ ...library, loaded: true, stamp })
      } catch {
        // No workspace open (yet), or the file is mid-write: the next poll retries.
      }
    },
    saveStyle: (style) =>
      write((styles) =>
        styles.some((entry) => entry.id === style.id)
          ? styles.map((entry) =>
              entry.id === style.id ? mergeTextStyleFamilies(entry, style) : entry,
            )
          : [...styles, style],
      ),
    removeStyle: (id) => write((styles) => styles.filter((style) => style.id !== id)),
  }
})
