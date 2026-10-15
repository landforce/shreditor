// Types for ./score.mjs.
import type { EditTemplate } from './template.mjs'

export interface TemplateCheck {
  key: string
  label: string
  status: 'pass' | 'warn' | 'info' | 'na'
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
  summary: { pass: number; warn: number; fail: 0 }
}
