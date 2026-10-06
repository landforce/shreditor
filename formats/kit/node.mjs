// Video Style Kit on disk (Node only): read a kit.json (or a kit folder holding
// one), hash it, write it back atomically, and list the fonts this machine
// can draw. The pure model is in ./kit.mjs.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, parseKit } from './kit.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** A kit file path: the file itself, or `kit.json` in a kit folder. */
export function resolveKitPath(input) {
  const full = path.resolve(String(input))
  const stat = fs.statSync(full, { throwIfNoEntry: false })
  if (!stat) throw new Error(`No kit at ${full}`)
  if (!stat.isDirectory()) return full
  const inside = path.join(full, 'kit.json')
  if (!fs.existsSync(inside)) throw new Error(`${full} is a folder without a kit.json`)
  return inside
}

/** Content hash of a kit: sha256 of its canonical JSON (formatting doesn't count). */
export function kitHash(kit) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(kit)).digest('hex')}`
}

/** Read and validate a kit: { path, kit, hash, warnings }. Throws a KitError when unusable. */
export function readKitFile(input) {
  const file = resolveKitPath(input)
  let value
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file}: not valid JSON (${error.message})`)
  }
  const { kit, warnings } = parseKit(value, { source: file })
  return { path: file, kit, hash: kitHash(kit), warnings }
}

/** Write a kit atomically (temp file in the same folder, then rename). */
export function writeKitFile(file, kit) {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  )
  fs.writeFileSync(temp, `${JSON.stringify(kit, null, 2)}\n`)
  fs.renameSync(temp, file)
}

function familiesFromFcList() {
  const out = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 20000 })
  return out.split('\n').flatMap((line) => line.split(','))
}

function familiesFromSystemProfiler() {
  const out = execFileSync('system_profiler', ['SPFontsDataType', '-json'], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 256 * 1024 * 1024,
  })
  const fonts = JSON.parse(out).SPFontsDataType ?? []
  return fonts.flatMap((font) => (font.typefaces ?? []).map((face) => face.family))
}

/**
 * Font families installed on this machine, lower-cased: fc-list when it is
 * there (fast), else macOS's system_profiler. Empty when neither works.
 */
export function installedFontFamilies() {
  for (const list of [familiesFromFcList, familiesFromSystemProfiler]) {
    try {
      const families = list()
        .map((family) =>
          String(family ?? '')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
      if (families.length) return new Set(families)
    } catch {
      // Not on this machine; try the next one.
    }
  }
  return new Set()
}

/** Families in Shreditor's font catalog (src/shared/typography/font-catalog.ts), lower-cased. */
export function catalogFontFamilies(repo = REPO) {
  const source = fs.readFileSync(path.join(repo, 'src/shared/typography/font-catalog.ts'), 'utf8')
  return new Set(
    [...source.matchAll(/family:\s*'([^']+)'/g)].map((match) => match[1].toLowerCase()),
  )
}
