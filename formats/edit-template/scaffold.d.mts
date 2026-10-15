// Types for ./scaffold.mjs.
import type { ResolvedFormat } from '../registry.mjs'
import type { EditTemplate } from './template.mjs'

export function scaffoldFromTemplate(
  template: EditTemplate,
  options: {
    format: ResolvedFormat
    fps: number
    media?: Array<{
      mediaId: string
      fileName?: string
      kind: string
      duration: number
      category: string | null
    }>
    request?: string
    hash?: string
    styles?: Set<string>
    speakers?: Array<{
      mediaId: string
      duration: number
      words: Array<{ text: string; start: number; end: number }>
    }>
    pauseSec?: number
    padFrames?: number
  },
): any
