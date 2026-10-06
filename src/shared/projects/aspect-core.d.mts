// Types for ./aspect-core.mjs (shared by the editor and the agent tools).

/** The aspect key of a canvas: "9:16" for 1080x1920 and 720x1280 alike. */
export function aspectKey(width: number, height: number): string

/** The available aspect nearest `target` (by ratio, either way); throws on none. */
export function closestAspect(target: string, available: readonly string[]): string
