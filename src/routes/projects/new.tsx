import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createLogger } from '@/shared/logging/logger'
import { NewProjectForm } from '@/features/projects/components/new-project-form'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { ShreditorLogo } from '@/components/brand/shreditor-logo'

const logger = createLogger('NewProject')

export const Route = createFileRoute('/projects/new')({
  component: NewProject,
  beforeLoad: async () => {
    try {
      const { loadProjects } = useProjectStore.getState()
      await loadProjects()
    } catch (err) {
      logger.warn('Failed to pre-load projects in beforeLoad:', err)
    }
  },
})

function NewProject() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background bg-[linear-gradient(180deg,#d7f5fa_0%,#eaf8fb_180px,var(--background)_420px)] bg-no-repeat">
      {/* Header */}
      <div>
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/">
            <ShreditorLogo
              variant="full"
              size="md"
              className="hover:opacity-80 transition-opacity"
            />
          </Link>
        </div>
      </div>

      {/* Content: the format first, then the name */}
      <div className="max-w-7xl mx-auto px-6 pb-10 pt-2">
        <NewProjectForm
          onCreated={(project) =>
            navigate({ to: '/editor/$projectId', params: { projectId: project.id } })
          }
        />
      </div>
    </div>
  )
}
