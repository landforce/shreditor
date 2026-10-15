// Types for ./vdb.mjs.
import type { EditTemplate } from './template.mjs'

/** Video DNA read from a file's text: get_video_dna JSON or the Markdown download. */
export function readVdb(text: string): any
export function templateFromVdb(
  dna: Record<string, any>,
  options?: { name?: string; file?: string; createdAt?: string },
): EditTemplate
