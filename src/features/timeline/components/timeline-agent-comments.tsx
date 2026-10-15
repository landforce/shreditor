import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startAgentComment, useAgentNotesStore } from '@/shared/state/agent-notes'

/**
 * Concise toolbar button (the N shortcut does the same): write a note for the
 * agent at the playhead. The composer opens on the Notes lane, where the note
 * then sits; `shred notes` reads it.
 */
export const AgentCommentButton = memo(function AgentCommentButton({
  btnSize,
}: {
  btnSize: React.CSSProperties
}) {
  const { t } = useTranslation()
  const hasProject = useAgentNotesStore((s) => s.projectId !== null)
  const label = t('timeline.concise.comment.button')

  return (
    <Button
      variant="ghost"
      size="icon"
      style={btnSize}
      disabled={!hasProject}
      onClick={() => startAgentComment()}
      aria-label={label}
      data-tooltip={label}
      data-testid="timeline-agent-comment-button"
    >
      <MessageSquarePlus className="w-3.5 h-3.5" />
    </Button>
  )
})
