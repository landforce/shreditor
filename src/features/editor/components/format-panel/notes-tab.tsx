import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { openAgentNotes, useAgentNotesStore } from '@/shared/state/agent-notes'
import { usePlaybackStore } from '@/shared/state/playback'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { useProjectFps } from '../concise/card-helpers'

/**
 * Notes for the agent's next pass: a general note (no timecode) written here,
 * and every open note listed, timed ones with a chip that seeks to them. Timed
 * notes are written on the timeline's Notes tray.
 */
export function NotesTab() {
  const { t } = useTranslation()
  const fps = useProjectFps()
  const notes = useAgentNotesStore((s) => s.notes)
  const failed = useAgentNotesStore((s) => s.failed)
  const [draft, setDraft] = useState('')
  const open = useMemo(() => openAgentNotes(notes), [notes])

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    if (await useAgentNotesStore.getState().add({ text })) setDraft('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1.5">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send()
          }}
          placeholder={t('editor.concise.pass.notePlaceholder')}
          aria-label={t('editor.concise.pass.note')}
          className="min-h-16 flex-1 resize-none text-xs"
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void send()}
          disabled={!draft.trim()}
          aria-label={t('editor.concise.pass.sendNote')}
          data-tooltip={t('editor.concise.pass.sendNote')}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
      {failed && <p className="text-xs text-destructive">{t('editor.concise.pass.noteFailed')}</p>}
      {open.length > 0 && (
        <ul className="space-y-1">
          {open.map((note) => (
            <li
              key={note.id}
              className="flex items-start gap-1.5 rounded-md bg-secondary/50 px-2 py-1 text-xs"
            >
              {note.frame !== undefined && (
                <button
                  type="button"
                  className="shrink-0 rounded bg-amber-500/15 px-1 font-mono text-[10px] leading-4 text-amber-700 tabular-nums hover:bg-amber-500/25 dark:text-amber-400"
                  onClick={() => usePlaybackStore.getState().setCurrentFrame(note.frame!)}
                  aria-label={t('editor.concise.pass.goToNote')}
                  data-tooltip={t('editor.concise.pass.goToNote')}
                >
                  {formatTimecodeCompact(note.frame, fps)}
                </button>
              )}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{note.text}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t('editor.concise.pass.removeNote')}
                onClick={() => void useAgentNotesStore.getState().remove(note.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
