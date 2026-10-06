// Types for ./kit.mjs: a Creator Stylesheet (kit.json, schema v2). Only the
// parts Shreditor reads are typed; everything else is kept as is.

export interface KitRect {
  x: number
  y: number
  w: number
  h: number
}

export interface KitCheck {
  type: string
  judgment?: 'look' | 'listen'
  [field: string]: unknown
}

export interface KitRule {
  id: string
  text: string
  check: KitCheck
}

export interface KitTextStyle {
  font: string
  weight: 400 | 500 | 600 | 700
  size: number
  sizeSmall?: number
  sizeSmallWhen?: { linesOver?: number; note?: string }
  lineHeight?: number
  letterSpacing?: number
  color: string
  box?: { color: string; radius?: number; padX?: number; padY?: number; perLine?: boolean } | null
  outline?: { color: string; width: number } | null
  tiltDeg?: number
  [field: string]: unknown
}

export interface KitPlacement {
  anchor: 'top' | 'center' | 'bottom' | 'free'
  x: number
  width: number
  y?: number
  align?: 'left' | 'center' | 'right'
  zone?: [number, number]
  default?: string
  positions?: Record<string, { y: number; when?: string }>
  [field: string]: unknown
}

export interface KitSection {
  style?: KitTextStyle | Record<string, unknown> | string
  placement?: KitPlacement | string
  motion?: { in?: string; out?: string; [field: string]: unknown }
  variants?: Record<string, Record<string, unknown>>
  must?: KitRule[]
  [field: string]: unknown
}

export interface Kit {
  schemaVersion: number
  kitVersion: string
  updatedAt?: string
  creator?: string
  canvas: [number, number]
  anchors?: Record<string, string>
  safeZones?: Record<string, KitRect>
  fonts: Record<
    string,
    {
      stack: string[]
      resolved?: string
      families?: Array<{ family: string; license?: string; files?: string[] }>
      weights?: number[]
    }
  >
  titles: KitSection
  captions: KitSection
  overlays: KitSection
  images?: KitSection
  greenscreen?: KitSection
  objects?: KitSection
  preferences?: Record<string, { on?: boolean; [field: string]: unknown }>
  referenceFrames?: Record<string, unknown>
  changelog?: Array<{ date: string; version: string; change: string; why?: string }>
  [field: string]: unknown
}

export function parseKit(
  value: unknown,
  options?: { source?: string },
): { kit: Kit; warnings: string[] }
export function canonicalJson(value: unknown): string
export function kitCanvas(kit: Kit): { width: number; height: number }
export function kitSectionFor(
  kit: Kit,
  name: string,
  aspect?: string,
): { section: KitSection; canvas: { width: number; height: number } } | undefined
export function kitAspect(kit: Kit): string
export function kitRules(kit: Kit): Array<KitRule & { section: string }>
export function bumpPatch(version: string): string
