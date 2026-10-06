import { describe, expect, it } from 'vite-plus/test'
import { scoreCaptionBoundaries, usesEnglishPhraseRules } from './caption-phrase-boundaries'

/** Words 0.3 s apart (0.1 s gaps) unless a gap is given before a word. */
function words(script: string, gaps: Record<number, number> = {}) {
  let time = 0
  return script.split(' ').map((text, index) => {
    time += gaps[index] ?? (index === 0 ? 0 : 0.1)
    const word = { text, start: time, end: time + 0.2 }
    time += 0.2
    return word
  })
}

/** The cost of breaking between `previous` and `next` in English. */
const between = (previous: string, next: string, english = true) =>
  scoreCaptionBoundaries(words(`${previous} ${next}`), english).cost[1]!

describe('scoreCaptionBoundaries', () => {
  it('rewards sentence ends, clause ends and pauses, longer pauses more', () => {
    expect(between('done.', 'next')).toBeLessThan(between('done,', 'next'))
    expect(between('done,', 'next')).toBeLessThan(0)
    const short = scoreCaptionBoundaries(words('well then', { 1: 0.2 }), false).cost[1]!
    const long = scoreCaptionBoundaries(words('well then', { 1: 0.6 }), false).cost[1]!
    expect(short).toBeLessThan(0)
    expect(long).toBeLessThan(short)
    expect(between('well', 'then', false)).toBe(0)
  })

  it('glues function words to what follows', () => {
    expect(between('the', 'course')).toBe(4)
    expect(between('to', 'build')).toBe(3)
    expect(between('is', 'going')).toBe(3)
    expect(between("don't", 'know')).toBe(3)
    expect(between('and', 'it')).toBe(2.5)
    expect(between('we', 'built')).toBe(1.5)
    expect(between('cost', 'me')).toBe(2)
    expect(between('me', 'later')).toBe(0)
  })

  it('treats a preposition before another phrase as a particle', () => {
    expect(between('around', 'to')).toBeLessThan(between('around', 'the'))
  })

  it('keeps numbers, units and names together', () => {
    // The language-neutral number rule adds to the English one.
    for (const [number, unit] of [
      ['$5', 'million'],
      ['$', '40'],
      ['10', 'percent'],
      ['twenty', 'five'],
    ])
      expect(between(number!, unit!)).toBeGreaterThanOrEqual(4)
    expect(between('five', 'hole')).toBe(2.5)
    expect(between('par', '16')).toBe(1.5)
    expect(between('Tiger', 'Woods')).toBe(3)
    expect(between('I', 'Woods')).not.toBe(3)
    // Digits hold together in any language.
    expect(between('40', '000', false)).toBe(4)
  })

  it('rewards a new phrase and costs a split between content words', () => {
    expect(between('warehouse', 'and')).toBe(-1.5)
    expect(between('warehouse', 'the')).toBe(-0.5)
    expect(between('golf', 'course')).toBe(1)
    const bonus = scoreCaptionBoundaries(words('course inside'), true).longChunkBonus[1]
    expect(bonus).toBe(-1)
  })

  it('glues fixed phrases', () => {
    const scores = scoreCaptionBoundaries(words('saves a lot of time'), true)
    expect(scores.cost[3]).toBe(2)
  })

  it('never splits a word from its own punctuation or contraction', () => {
    expect(between('Hello', ',')).toBe(100)
    expect(between('it', "'s")).toBe(100)
    expect(between('do', "n't")).toBe(100)
  })

  it('prices a word on its own by how it is set off', () => {
    const lone = scoreCaptionBoundaries(
      words('We finished. Done. Then okay, we go on', { 2: 0.5, 3: 0.6 }),
      true,
    ).loneWordCost
    expect(lone[2]).toBe(0.5) // "Done." between pauses
    expect(lone[3]).toBe(1.5) // "Then" after a sentence end
    expect(lone[4]).toBe(1.5) // "okay,"
    expect(lone[6]).toBe(3) // "go" mid-phrase
    expect(lone.at(-1)).toBe(3) // "on": no pause or punctuation before it
  })
})

describe('usesEnglishPhraseRules', () => {
  const english = words('so I asked it to design a golf course for the warehouse')
  const spanish = words('voy a poner un campo de golf dentro de la bodega')

  it('follows the transcript language when it has one', () => {
    expect(usesEnglishPhraseRules(spanish, 'en')).toBe(true)
    expect(usesEnglishPhraseRules(spanish, 'en-US')).toBe(true)
    expect(usesEnglishPhraseRules(english, 'es')).toBe(false)
    expect(usesEnglishPhraseRules(english, 'english')).toBe(true)
  })

  it('detects English from common words otherwise', () => {
    expect(usesEnglishPhraseRules(english)).toBe(true)
    expect(usesEnglishPhraseRules(english, 'auto')).toBe(true)
    expect(usesEnglishPhraseRules(spanish)).toBe(false)
    expect(usesEnglishPhraseRules([])).toBe(false)
  })
})
