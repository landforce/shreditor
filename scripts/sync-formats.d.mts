// Types for ./sync-formats.mjs (used by formats/sync-formats.test.ts).

export interface VendoredFile {
  formatId: string
  /** Path in the ai-video-editor plugin. */
  source: string
  /** Path in this repository. */
  target: string
  /** Guide hash the format's targets were reviewed against (guides only). */
  reviewedHash?: string
}

export interface SyncedFile extends VendoredFile {
  status: 'copied' | 'unchanged' | 'stale' | 'refused' | 'missing'
  hash?: string
  previousHash?: string | null
  /** True when the source differs from reviewedHash. */
  review?: boolean
}

export const FORBIDDEN_WORDS: string[]
export function sha256(text: string): string
export function hasForbiddenWord(text: string): boolean
export function vendoredFiles(): VendoredFile[]
export function renderVendored(source: string, content: string, hash: string): string
export function readVendoredHash(text: string | null | undefined): string | null
export function syncFormats(options?: {
  sourceRoot?: string
  repoRoot?: string
  write?: boolean
  files?: VendoredFile[]
}): { files: SyncedFile[]; ok: boolean }
export function describeSync(report: { files: SyncedFile[] }): string[]
