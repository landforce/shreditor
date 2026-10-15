// `shred kit set`: change values in a kit by path ("titles.style.size" 104).
// The path must exist and the value keep its type, so a typo can't add a key
// nothing reads; `force` allows both. The kit's own bookkeeping (versions,
// timestamps, changelog) is set by withChangelogEntry, never by hand.
import { canonicalJson, parseKit } from './kit.mjs'

/** Keys the kit maintains itself. */
const MANAGED = new Set(['schemaVersion', 'kitVersion', 'updatedAt', 'changelog'])

const kindOf = (value) => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)

/** "titles.style.box.padX" -> ['titles', 'style', 'box', 'padX']; numeric parts index arrays. */
export function kitPath(text) {
  const parts = String(text ?? '')
    .split('.')
    .map((part) => part.trim())
  if (!parts.length || parts.some((part) => !part))
    throw new Error(`"${text}" is not a kit path (like titles.style.size)`)
  return parts
}

/**
 * A command-line value for a kit field: JSON when it parses (104, true,
 * ["#fff"], {"on":true}), the text as is otherwise. A string field takes the
 * text as is, so "700" stays "700" and an unquoted font name works.
 */
export function kitValue(text, current) {
  if (typeof current === 'string') {
    try {
      const parsed = JSON.parse(text)
      return typeof parsed === 'string' ? parsed : String(text)
    } catch {
      return String(text)
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return String(text)
  }
}

/**
 * Command-line words as [path, text] pairs: `path value` or `path=value` (the
 * form for values that start with a dash).
 */
export function kitPairs(words) {
  const pairs = []
  for (let i = 0; i < words.length; i++) {
    const glued = /^([a-z]\w*(?:\.\w+)*)=(.*)$/is.exec(words[i])
    if (glued) pairs.push([glued[1], glued[2]])
    else if (i + 1 < words.length) pairs.push([words[i], words[++i]])
    else throw new Error(`${words[i]} has no value`)
  }
  return pairs
}

/** The object holding the path's last key (made on the way with `force`). */
function parentOf(kit, parts, pathText, force) {
  let target = kit
  for (const [i, part] of parts.slice(0, -1).entries()) {
    const child = target[part]
    if (child === undefined && force) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    else if (child === null || typeof child !== 'object')
      throw new Error(
        `${parts.slice(0, i + 1).join('.')} is ${child === undefined ? 'not in the kit' : `a ${kindOf(child)}`}: ${pathText} can't be set`,
      )
    target = target[part]
  }
  return target
}

/** The value `text` sets in place of `from`, refused when it doesn't fit (unless `force`). */
function checkedValue(pathText, from, text, force) {
  if (from === undefined && !force)
    throw new Error(`${pathText} is not in the kit (check the path; --force adds it)`)
  const to = kitValue(text, from)
  // null is "off": it may become a value, and a value may be switched off.
  if (from != null && to !== null && kindOf(from) !== kindOf(to) && !force)
    throw new Error(
      `${pathText} is a ${kindOf(from)} (${JSON.stringify(from)}), not a ${kindOf(to)}: --force changes its type`,
    )
  return to
}

/**
 * The kit with each [path, text] pair set, checked against the kit schema.
 * Returns the new kit (bookkeeping untouched) and the changes as
 * { path, from, to }; a value that is already set is no change.
 */
export function kitWithValues(kit, pairs, { force = false } = {}) {
  const next = structuredClone(kit)
  const changes = []
  for (const [pathText, text] of pairs) {
    const parts = kitPath(pathText)
    if (MANAGED.has(parts[0]))
      throw new Error(`${parts[0]} is kept by the kit itself (the changelog records each set)`)
    const target = parentOf(next, parts, pathText, force)
    const key = parts.at(-1)
    const from = target[key]
    const to = checkedValue(pathText, from, text, force)
    if (canonicalJson(from) === canonicalJson(to)) continue
    target[key] = to
    changes.push({ path: parts.join('.'), from, to })
  }
  parseKit(next)
  return { kit: next, changes }
}
