/**
 * Background removal on a video clip (docs/background-removal.md). The masks
 * are analysed from the clip's source media and stored in the workspace; these
 * settings only say how to use them, so changing them never re-runs a model.
 */
export type CutoutSubject = 'auto' | 'person' | 'object'

/** Brush tools: plain discs (brush adds, eraser removes) or SlimSAM regions tracked through the clip. */
export type CutoutStrokeTool = 'brush' | 'eraser' | 'smartBrush' | 'smartEraser'

/**
 * A brush correction painted on one source frame (docs/background-removal.md,
 * Smart brush). Points are fractions of the source frame.
 */
export interface CutoutStroke {
  tool: CutoutStrokeTool
  /** Source time the stroke was painted at, in seconds. */
  at: number
  /** Brush radius as a fraction of the source frame's short side. */
  size: number
  points: Array<[number, number]>
}

export interface CutoutSettings {
  enabled: boolean
  /** What to keep: a person (portrait matting), the main object, or auto (person, else object). */
  subject: CutoutSubject
  /** Edge softness in source pixels (0-100, default 0). Applied at draw time. */
  feather?: number
  /** Keep the background and remove the subject. */
  invert?: boolean
  /** Edge hardening 0-1 (0 = the model's soft matte, 1 = a hard edge). */
  refine?: number
  /** Masks per second of source (default 10), or 'full' for every source frame. */
  sampleRate?: number | 'full'
  strokes?: CutoutStroke[]
}
