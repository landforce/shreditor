import { createFileRoute, redirect } from '@tanstack/react-router'

// Shreditor has no landing page: the root opens the project list.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/projects' })
  },
})
