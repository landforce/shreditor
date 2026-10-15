// Types for ./template.mjs. Slots and pacing are documented there.
// Plain JSON (formats/edit-template/template.mjs documents its shape).
export type EditTemplate = any
export const TEMPLATE_KIND: 'shreditor-edit-template'
export const TEMPLATE_VERSION: 1
export function pacingFromSlots(
  slots: Array<Record<string, any>>,
  durationSec: number,
  options?: { wordsPerMin?: number | null; reported?: unknown },
): any
export function templateProblems(raw: unknown): string[]
export function templateSlug(text: unknown): string
