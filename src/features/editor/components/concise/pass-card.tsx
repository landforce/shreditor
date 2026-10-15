import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ellipsis, LayoutTemplate, Save, Send, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { openAgentNotes, useAgentNotesStore } from '@/shared/state/agent-notes'
import { usePlaybackStore } from '@/shared/state/playback'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { useFormatScorecardStore } from '@/shared/state/format-scorecard'
import { useSelectionStore } from '@/shared/state/selection'
import { variantName } from '@/shared/formats/format-text'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  formatTimelineCommandLabel,
  useTimelineCommandStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { useProjectSyncStore } from '../../agent-sync/sync-store'
import { useFormatPanelStore } from '../../stores/format-panel-store'
import { ChangeFormatDialog } from '../format-panel/change-format-dialog'
import { useResolvedProjectFormat } from '../format-panel/project-format'
import { useProjectFps } from './card-helpers'
import { changesSincePass } from './changes-since-pass'
import { SAVE_PROJECT_EVENT } from './events'
import { Cell, ContextCard, MoreDrawer, type Verb } from './card-parts'

export function PassCard() {
  const { t } = useTranslation()
  const projectId = useProjectStore((s) => s.currentProject?.id)
  const [moreOpen, setMoreOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const isDirty = useTimelineStore((s) => s.isDirty)

  const openScorecard = useCallback(() => {
    useSelectionStore.getState().clearSelection()
    useFormatPanelStore.getState().setTab('format')
    setMoreOpen(true)
  }, [])
  const save = useCallback(() => window.dispatchEvent(new CustomEvent(SAVE_PROJECT_EVENT)), [])

  const verbs: Verb[] = [
    {
      id: 'scorecard',
      icon: LayoutTemplate,
      label: t('editor.concise.pass.scorecard'),
      onClick: openScorecard,
    },
    {
      id: 'format',
      icon: LayoutTemplate,
      label: t('editor.concise.pass.changeFormat'),
      onClick: () => setChangeOpen(true),
      disabled: !projectId,
    },
    {
      id: 'save',
      icon: Save,
      label: t('editor.concise.pass.save'),
      onClick: save,
      disabled: !isDirty,
    },
    {
      id: 'more',
      icon: Ellipsis,
      label: t('editor.concise.more.label'),
      onClick: () => setMoreOpen(true),
    },
  ]

  return (
    <ContextCard
      testId="concise-pass-card"
      title={t('editor.concise.pass.title')}
      subtitle={t('editor.concise.pass.subtitle')}
      verbs={verbs}
    >
      <Cell title={t('editor.concise.pass.format')}>
        <FormatCell onScorecard={openScorecard} onChange={() => setChangeOpen(true)} />
      </Cell>
      <Cell title={t('editor.concise.pass.changes')}>
        <ChangesCell isDirty={isDirty} onSave={save} />
      </Cell>
      <Cell title={t('editor.concise.pass.note')} span={2} className="@3xl:col-span-1">
        {projectId ? (
          <NotesCell />
        ) : (
          <p className="text-xs text-muted-foreground">{t('editor.concise.pass.noProject')}</p>
        )}
      </Cell>
      <MoreDrawer open={moreOpen} onOpenChange={setMoreOpen} />
      {projectId && (
        <ChangeFormatDialog projectId={projectId} open={changeOpen} onOpenChange={setChangeOpen} />
      )}
    </ContextCard>
  )
}

function Chip({ count, className, label }: { count: number; className: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${className}`}
    >
      {count} {label}
    </span>
  )
}

function FormatCell({ onScorecard, onChange }: { onScorecard: () => void; onChange: () => void }) {
  const { t } = useTranslation()
  const format = useResolvedProjectFormat()
  const summary = useFormatScorecardStore((s) => s.card?.summary)
  return (
    <div className="space-y-2">
      {format ? (
        <div>
          <div className="text-sm font-semibold leading-tight">{format.name}</div>
          {format.variant && (
            <div className="text-xs text-muted-foreground">
              {variantName(t, format.id, format.variant)}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{t('editor.concise.pass.noFormat')}</div>
      )}
      {summary && (
        <div className="flex flex-wrap gap-1">
          <Chip
            count={summary.fail}
            label={t('editor.concise.pass.fail')}
            className="bg-destructive/15 text-destructive"
          />
          <Chip
            count={summary.warn}
            label={t('editor.concise.pass.warn')}
            className="bg-amber-500/15 text-amber-600"
          />
          <Chip
            count={summary.pass}
            label={t('editor.concise.pass.pass')}
            className="bg-emerald-500/15 text-emerald-600"
          />
        </div>
      )}
      <div className="flex gap-3 text-xs">
        <button type="button" className="text-primary hover:underline" onClick={onScorecard}>
          {t('editor.concise.pass.scorecard')}
        </button>
        <button type="button" className="text-primary hover:underline" onClick={onChange}>
          {t('editor.concise.pass.changeFormat')}
        </button>
      </div>
    </div>
  )
}

function ChangesCell({ isDirty, onSave }: { isDirty: boolean; onSave: () => void }) {
  const { t } = useTranslation()
  const undoStack = useTimelineCommandStore((s) => s.undoStack)
  const syncStatus = useProjectSyncStore((s) => s.status)
  const changes = useMemo(() => changesSincePass(undoStack), [undoStack])
  return (
    <div className="space-y-2">
      {changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('editor.concise.pass.noChanges')}</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {changes.map((entry) => (
            <li key={entry.timestamp + entry.command.type} className="truncate">
              {formatTimelineCommandLabel(entry.command)}
            </li>
          ))}
        </ul>
      )}
      {syncStatus === 'conflict' && (
        <p className="flex items-center gap-1 text-xs text-amber-600">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {t('editor.concise.pass.conflict')}
        </p>
      )}
      {isDirty && (
        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={onSave}>
          <Save className="h-3.5 w-3.5" />
          {t('editor.concise.pass.save')}
        </Button>
      )}
    </div>
  )
}

function NotesCell() {
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
