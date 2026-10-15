// Types for ./roles.mjs.
import type { ResolvedFormat } from '../registry.mjs'

type Shot = Record<string, any>
export function inferShotType(shot: Shot): string
export function shotRole(shot: Shot): 'speaker' | 'images' | 'screen' | 'broll' | 'shots'
export function slotCategories(role: string): string[]
export function slotTrackRole(role: string, format: ResolvedFormat): string
export function textRole(kind: unknown): { role: 'title' | 'labels'; style: string }
export function textPattern(kind: unknown, reference: string, hookTemplate: string | null): string
export function suggestTemplateFormat(input: {
  referenceFormat?: string | null
  slots: Array<Record<string, any>>
  pacing: Record<string, any>
  keyed?: boolean
}): { id: string; variant?: string; reason: string }
