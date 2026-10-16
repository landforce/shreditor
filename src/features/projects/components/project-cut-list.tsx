import type { SyntheticEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Crown, Layers } from 'lucide-react'
import type { Project } from '@/types/project'
import { cutLabelOf, isMainCut } from '@/shared/projects/cuts.mjs'
import { cardCanvas } from './project-card'

// A row opens its cut; the card around it must not select or open its Main.
const keepFromCard = (event: SyntheticEvent) => event.stopPropagation()

/**
 * The cuts of a group under its card in the project list: label and size,
 * each opening its cut. Nothing for a project that is no group's.
 */
export function ProjectCutList({ cuts }: { cuts: readonly Project[] }) {
  const { t } = useTranslation()
  if (cuts.length === 0) return null
  return (
    <div className="mt-3 border-t border-border pt-2" data-testid="project-cuts">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Layers className="h-3 w-3" aria-hidden="true" />
        {t('cuts.projects.count', { count: cuts.length })}
      </p>
      <ul className="space-y-0.5">
        {cuts.map((cut) => {
          const { width, height } = cardCanvas(cut)
          return (
            <li key={cut.id}>
              <Link
                to="/editor/$projectId"
                params={{ projectId: cut.id }}
                data-testid="project-cut"
                aria-label={t('cuts.projects.open', { label: cutLabelOf(cut) })}
                className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-muted"
                onClick={keepFromCard}
                onDoubleClick={keepFromCard}
                onKeyDown={keepFromCard}
                onMouseDown={keepFromCard}
              >
                {isMainCut(cut) && (
                  <Crown className="h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{cutLabelOf(cut)}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {width}×{height}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
