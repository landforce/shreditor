// Words of a performance: what a line says, by its transcript, and how alike
// two lines are. Transcript words are `{ text, start, end }` in source seconds
// (the built-in whisper transcript, ../../scorecard.mjs `transcriptWords`).

/** Lowercase word tokens, punctuation dropped ("Don't!" -> "dont"). */
export function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Words whose middle falls in [inSec, outSec), in order. */
export function wordsIn(words, inSec, outSec) {
  return (words ?? []).filter((word) => {
    const middle = (word.start + word.end) / 2
    return middle >= inSec && middle < outSec
  })
}

export const joinText = (words) =>
  words
    .map((word) => String(word.text ?? '').trim())
    .filter(Boolean)
    .join(' ')

/** Length of the longest common subsequence of two token lists. */
export function commonLength(a, b) {
  let previous = Array.from({ length: b.length + 1 }, () => 0)
  for (const token of a) {
    const row = [0]
    for (const [j, other] of b.entries())
      row.push(token === other ? previous[j] + 1 : Math.max(previous[j + 1], row[j]))
    previous = row
  }
  return previous[b.length]
}

/** How alike two texts are, 0 to 1: shared words in order over both lengths. */
export function similarity(a, b) {
  const [x, y] = [tokens(a), tokens(b)]
  if (!x.length && !y.length) return 1
  return (2 * commonLength(x, y)) / (x.length + y.length)
}

/**
 * Where a phrase is said in a line's words: `{ first, last }` word indexes of
 * its first occurrence, or null.
 */
export function findPhrase(words, phrase) {
  const wanted = tokens(phrase)
  if (!wanted.length) return null
  // One token per word (a word whisper heard as "co-op" is one word here).
  const said = words.map((word) => tokens(word.text).join(''))
  const target = wanted.join('')
  for (let first = 0; first < said.length; first += 1) {
    let joined = ''
    for (let last = first; last < said.length && joined.length < target.length; last += 1) {
      joined += said[last]
      if (joined === target) return { first, last }
    }
  }
  return null
}
