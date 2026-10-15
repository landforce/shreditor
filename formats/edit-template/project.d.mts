// Types for ./project.mjs.
import type { EditTemplate } from './template.mjs'

export function templateFromProject(
  project: Record<string, any>,
  options?: {
    mediaById?: Record<string, any>
    name?: string
    outline?: unknown
    createdAt?: string
  },
): EditTemplate
