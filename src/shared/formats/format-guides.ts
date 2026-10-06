import type { FormatId } from '@formats/registry.mjs'

// The vendored guides, as raw Markdown, loaded on demand (each is its own chunk).
const GUIDES: Record<FormatId, () => Promise<{ default: string }>> = {
  'graphic-yap': () => import('@formats/graphic-yap/guide.md?raw'),
  greenscreen: () => import('@formats/greenscreen/guide.md?raw'),
  vlog: () => import('@formats/vlog/guide.md?raw'),
  'ten-shot': () => import('@formats/ten-shot/guide.md?raw'),
}

/** The format's guide (formats/<id>/guide.md) as Markdown. */
export async function loadFormatGuide(id: FormatId): Promise<string> {
  return (await GUIDES[id]()).default
}
