import { useCallback, useEffect, useState } from 'react'
import type {
  MotionTemplate,
  MotionTemplateMediaRef,
} from '@/shared/motion-templates/template-core.mjs'
import {
  listMotionTemplates,
  readMotionTemplateThumbnail,
} from '@/infrastructure/storage/workspace-fs/motion-templates'
import { readTemplateLibraryVersion } from '@/infrastructure/storage/bridge-fs/bridge-templates'
import { createLogger } from '@/shared/logging/logger'
import { findMissingTemplateMedia } from '../services/motion-template-service'

const logger = createLogger('MotionTemplateLibrary')
const POLL_MS = 1000

export interface LibraryTemplate {
  template: MotionTemplate
  /** Media the template uses that this workspace lacks (insert is refused). */
  missingMedia: MotionTemplateMediaRef[]
}

async function loadLibrary(): Promise<LibraryTemplate[]> {
  const templates = await listMotionTemplates()
  return Promise.all(
    templates.map(async (template) => ({
      template,
      missingMedia: await findMissingTemplateMedia(template),
    })),
  )
}

/**
 * The template library, re-read when the bridge's change stamp moves (the
 * agent saving or importing templates) while `active`.
 */
export function useMotionTemplateLibrary(active: boolean) {
  const [entries, setEntries] = useState<LibraryTemplate[]>([])
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      setEntries(await loadLibrary())
    } catch (error) {
      logger.warn('Could not read the template library', error)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    // undefined until the first read; null when the workspace has no bridge (no stamp).
    let seen: string | null | undefined
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      const version = await readTemplateLibraryVersion()
      if (seen === undefined || version !== seen) await reload()
      seen = version
      busy = false
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, reload])

  return { entries, loaded, reload }
}

/** An object URL for a template's thumbnail (re-read when the template changes). */
export function useTemplateThumbnail(id: string, updatedAt: number): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void readMotionTemplateThumbnail(id)
      .then((blob) => {
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => setUrl(null))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, updatedAt])
  return url
}
