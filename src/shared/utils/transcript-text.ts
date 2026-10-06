const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
/** Punctuation and symbols hug the word before, except a currency sign ("cost me $40"). */
const NO_SPACE_BEFORE = /^(?!\p{Sc})[\p{P}\p{S}]/u
const NO_SPACE_AFTER = /[\p{Ps}\p{Pi}]$/u

function lastCharacter(value: string): string {
  return Array.from(value.trim()).at(-1) ?? ''
}

function firstCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? ''
}

export function needsTranscriptWordSeparator(previous: string, next: string): boolean {
  const previousCharacter = lastCharacter(previous)
  const nextCharacter = firstCharacter(next)
  if (!previousCharacter || !nextCharacter) return false

  if (CJK_CHARACTER.test(previousCharacter) || CJK_CHARACTER.test(nextCharacter)) {
    return false
  }

  return !NO_SPACE_AFTER.test(previousCharacter) && !NO_SPACE_BEFORE.test(nextCharacter)
}

export function joinTranscriptWords(words: readonly string[]): string {
  const normalized = words.map((word) => word.trim()).filter(Boolean)
  return normalized.reduce((text, word, index) => {
    if (index === 0) return word
    const previous = normalized[index - 1] ?? ''
    return `${text}${needsTranscriptWordSeparator(previous, word) ? ' ' : ''}${word}`
  }, '')
}
