/**
 * Start the export dialog's "All cuts" on the workspace bridge
 * (server/cut-export-bridge.mjs) and follow it until every cut is exported.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useCutsStore } from '@/shared/state/cuts'

const ENDPOINT = '/__shreditor/cuts/export'
const POLL_MS = 1000

export interface CutExportRow {
  id: string
  label: string
  name: string
  status: 'queued' | 'exporting' | 'done' | 'failed'
  engine?: string | null
  path?: string | null
  error?: string
}

export interface CutExportJob {
  id: string
  done: boolean
  cuts: CutExportRow[]
}

async function bridgeJson(input: string, init?: RequestInit): Promise<CutExportJob> {
  const res = await fetch(input, { cache: 'no-store', ...init })
  const body = (await res.json().catch(() => ({}))) as CutExportJob & { message?: string }
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
  return body
}

export function useAllCutsExport() {
  const [job, setJob] = useState<CutExportJob | null>(null)

  useEffect(() => {
    if (!job || job.done) return
    const timer = window.setTimeout(() => {
      bridgeJson(`${ENDPOINT}?job=${encodeURIComponent(job.id)}`)
        .then(setJob)
        .catch((error: Error) => toast.error(error.message))
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [job])

  const start = async (settings: { codec?: string; quality?: string }) => {
    const project = useCutsStore.getState().projectId
    try {
      setJob(
        await bridgeJson(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project, codec: settings.codec, quality: settings.quality }),
        }),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return { job, start, close: () => setJob(null) }
}
