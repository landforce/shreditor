import { createLazyFileRoute } from '@tanstack/react-router'
import { Editor } from '@/features/editor/components/editor'

export const Route = createLazyFileRoute('/editor/$projectId')({
  component: EditorPage,
})

function EditorPage() {
  const { projectId } = Route.useParams()
  const { project, migration } = Route.useLoaderData()

  // Keyed by project: switching cuts (docs/cuts.md) mounts a fresh editor.
  return <Editor key={projectId} projectId={projectId} project={project} migration={migration} />
}
