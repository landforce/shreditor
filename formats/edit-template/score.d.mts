// Types for ./score.mjs.
import type { EditTemplate } from './template.mjs'

export interface TemplateCheck {
  key: string
  label: string
  status: 'close' | 'differs' | 'info' | 'na'
  value: unknown
  target: string
  detail: string
  ranges: Array<{ startFrame: number; endFrame: number }>
}

export function scoreTemplate(
  project: Record<string, any>,
  template: EditTemplate,
  options?: { mediaById?: Record<string, any> },
): {
  template: string
  source: Record<string, any>
  measured: Record<string, any>
  checks: any[]
  summary: { close: number; differs: number }
}
