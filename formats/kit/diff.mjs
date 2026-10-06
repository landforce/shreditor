// What changed between two versions of a kit, value by value, for
// `shred kit status` (the file vs what the project applied) and re-apply.
import { canonicalJson } from './kit.mjs'

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function walk(before, after, at, changes) {
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      walk(before[key], after[key], at ? `${at}.${key}` : key, changes)
    return changes
  }
  if (canonicalJson(before) !== canonicalJson(after))
    changes.push({ path: at, from: before, to: after })
  return changes
}

/** Every value that differs, as { path: "titles.style.size", from, to } (lists compare whole). */
export function diffKits(before, after) {
  return walk(before ?? {}, after ?? {}, '', [])
}

const show = (value) => {
  if (value === undefined) return '(none)'
  const text = typeof value === 'string' ? value : canonicalJson(value)
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

/** The changes as lines ("titles.style.size: 96 -> 104"), at most `limit` and a count of the rest. */
export function describeKitDiff(changes, limit = 12) {
  const lines = changes.slice(0, limit).map((c) => `${c.path}: ${show(c.from)} -> ${show(c.to)}`)
  if (changes.length > limit) lines.push(`... and ${changes.length - limit} more`)
  return lines
}
