// Types for ./edit-template-fixtures.mjs.
export const video: (
  fileName: string,
  duration: number,
  category: string,
  extra?: object,
) => any
export const png: (fileName: string, category?: string) => any
export const yapTracks: any[]
export const clip: (
  id: string,
  mediaId: string,
  trackId: string,
  from: number,
  length: number,
  sourceStart?: number,
  extra?: object,
) => any
export function yapProject(): any
export const yapMedia: any
