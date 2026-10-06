import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resolveFormat } from '@formats/registry.mjs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormatCards, type FormatSelection } from '@/shared/formats/format-cards'
import { findMissingFormatTracks } from '@/shared/formats/format-tracks'
import { roleLabel } from '@/shared/formats/format-text'
import {
  useCompositionNavigationStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { applyProjectFormat, useProjectFormatRecord } from './project-format'

/**
 * The format's layout tracks this timeline lacks, as role names ("Speaker
 * audio" where the role also has a video track).
 */
function useMissingTracks(selection: FormatSelection | null): string[] {
  const { t } = useTranslation()
  const tracks = useTimelineStore((s) => s.tracks)
  return useMemo(() => {
    if (!selection) return []
    const format = resolveFormat(selection.id, selection.variant)
    const hasVideo = (role: string) =>
      format.tracks.some((entry) => entry.role === role && entry.kind === 'video')
    return findMissingFormatTracks(tracks, format).map((entry) =>
      entry.kind === 'audio' && hasVideo(entry.role)
        ? t('formats.change.audioTrack', { role: roleLabel(t, entry.role) })
        : roleLabel(t, entry.role),
    )
  }, [selection, tracks, t])
}

/**
 * Set or change the project's format. Re-targets the scorecard, and can add
 * the new format's missing tracks; never moves or deletes anything.
 */
export function ChangeFormatDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const current = useProjectFormatRecord()
  const onMain = useCompositionNavigationStore((s) => s.activeCompositionId === null)
  const [selection, setSelection] = useState<FormatSelection | null>(null)
  const [addTracks, setAddTracks] = useState(true)
  const [saving, setSaving] = useState(false)
  const missing = useMissingTracks(selection)

  useEffect(() => {
    if (!open) return
    setSelection(current ? { id: current.id, variant: current.variant ?? null } : null)
    setAddTracks(true)
  }, [open, current])

  const unchanged =
    !selection || (current?.id === selection.id && (current.variant ?? null) === selection.variant)
  const mode = current ? 'change' : 'set'

  const confirm = async () => {
    if (!selection) return
    setSaving(true)
    try {
      const { added } = await applyProjectFormat(projectId, selection, {
        addTracks: addTracks && missing.length > 0,
      })
      toast.success(t('formats.change.done', { format: resolveFormat(selection.id).name }), {
        description: added.length
          ? t('formats.change.tracksAdded', { count: added.length })
          : undefined,
      })
      onOpenChange(false)
    } catch (error) {
      toast.error(t('formats.panel.saveFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'set' ? t('formats.change.setTitle') : t('formats.change.title')}
          </DialogTitle>
          <DialogDescription>{t('formats.change.description')}</DialogDescription>
        </DialogHeader>

        <FormatCards value={selection} onChange={setSelection} compact />

        {selection && (
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
            {missing.length === 0 ? (
              <p className="text-muted-foreground">{t('formats.change.noMissing')}</p>
            ) : (
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  checked={addTracks && onMain}
                  disabled={!onMain}
                  onChange={(event) => setAddTracks(event.target.checked)}
                />
                <span>
                  <span className="font-medium text-foreground">
                    {t('formats.change.addTracks', { tracks: missing.join(', ') })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {onMain ? t('formats.change.addTracksHint') : t('formats.change.mainOnly')}
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void confirm()} disabled={unchanged || saving}>
            {mode === 'set' ? t('formats.change.confirmSet') : t('formats.change.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
