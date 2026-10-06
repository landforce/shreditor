/**
 * Where a caption may break between two spoken words, scored the way an
 * editor chunks short-form captions: break at sentence and clause ends, at
 * real pauses and before a new phrase (a conjunction, a preposition); never
 * after "a", "the", "to", between "is" and "going", inside "$5 million" or
 * inside a name.
 *
 * The word lists are English. Other languages get the language-neutral rules
 * only: punctuation, pauses and numbers written in digits.
 */

export interface TimedWord {
  text: string
  start: number
  end: number
}

export interface CaptionBoundaries {
  /**
   * `cost[k]`: the cost of breaking before word `k` (1 .. n-1). Negative is a
   * good place to break, positive a bad one.
   */
  cost: number[]
  /** Added to `cost[k]` when the chunk ending before word `k` has 2+ words. */
  longChunkBonus: number[]
  /**
   * What word `k` costs as a chunk of its own: little for a punch word set
   * off by pauses, more for one set off by punctuation ("inside." at a
   * sentence end, "Okay," after one), most mid-phrase.
   */
  loneWordCost: number[]
}

const wordSet = (list: string) => new Set(list.split(' '))

const DETERMINERS = wordSet(
  'a an the my your his our their its this that these those some any every each another',
)
const PREPOSITIONS = wordSet(
  'to of in on at for with from by into onto about over under through between without within across after before around upon toward towards against during among than per via inside outside behind beyond',
)
const CLAUSE_STARTERS = wordSet(
  "and but so because cause 'cause or nor yet then which who whom whose where when while if unless until though although since whether that whereas once",
)
const AUXILIARIES = wordSet(
  'am is are was were be been being do does did have has had can could will would shall should may might must gonna wanna gotta',
)
const SUBJECT_PRONOUNS = wordSet('i we they he she')
const OBJECT_PRONOUNS = wordSet('me him us them')
const TENS = wordSet('twenty thirty forty fifty sixty seventy eighty ninety')
const NUMBER_WORDS = wordSet(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen hundred thousand million billion trillion half dozen couple few',
)
const UNITS = wordSet(
  'percent % k grand dollar dollars bucks cents euros pounds hundred thousand million billion trillion times x day days week weeks month months year years hour hours minute minutes second seconds mins hrs people grams kg lbs miles mile feet foot inches km meters metres degrees followers views subscribers',
)
const FIXED_PHRASES = [
  'a lot of',
  'kind of',
  'sort of',
  'going to',
  'have to',
  'has to',
  'had to',
  'want to',
  'need to',
  'got to',
  'used to',
  'able to',
  'as well',
  'at least',
  'of course',
  'a bit',
  'a little',
  'right now',
  'by the way',
  'each other',
  'in front of',
  'as soon as',
  'as long as',
  'even though',
  'more than',
  'less than',
  'no one',
  'thank you',
  'you know',
].map((phrase) => phrase.split(' '))

/** Common English words: a transcript with enough of them is English. */
const ENGLISH_MARKERS = wordSet(
  "the and to of a i you it is that in was for on with this my we so but what i'm it's don't just like have be are they",
)

const SENTENCE_END = /[.!?。！？…]["'”’)\]]*$/u
const CLAUSE_END = /[,;:，、；：—–]["'”’)\]]*$/u
const ANY_TRAILING_PUNCTUATION = /[\p{P}]$/u
/** Tokens that belong to the word before them: punctuation, "'s", "n't". */
const ATTACHES_LEFT = /^(?:[,.!?;:%)\]}…，。！？；：、]|['’](?:s|m|re|ve|ll|d)\b|n['’]t\b)/iu
const AUX_CONTRACTION = /(?:['’](?:m|re|ve|ll|d|s)|n['’]t)$/iu
const HAS_DIGIT = /\d/u
const STARTS_WITH_DIGIT = /^\d/u
const CURRENCY_ONLY = /^[\p{Sc}#]+$/u
const CAPITALISED = /^\p{Lu}/u
const I_FORMS = /^i(?:['’](?:m|ve|ll|d))?$/iu

const SENTENCE_END_REWARD = -4
const CLAUSE_END_REWARD = -2.5
const CLAUSE_START_REWARD = -1.5
const PHRASE_START_REWARD = -0.5
const PREPOSITION_REWARD = -1
const DETERMINER_GLUE = 4
const PREPOSITION_GLUE = 3
const PARTICLE_GLUE = 0.5
const AUXILIARY_GLUE = 3
const NUMBER_GLUE = 4
const NAME_GLUE = 3
const FIXED_PHRASE_GLUE = 2
const PRONOUN_GLUE = 1.5
/** "cost | me": a verb keeps its pronoun object. */
const OBJECT_GLUE = 2
/** "and | I asked": a conjunction starts the phrase after it. */
const CONJUNCTION_GLUE = 2.5
const CONTENT_GLUE = 1
/** "five hole", "3D model", "10 people": a number and what it counts. */
const QUANTITY_GLUE = 2.5
/** "par 16", "Session 23". */
const NUMBER_AFTER_GLUE = 1.5
/** Never split a word from its own punctuation or contraction. */
const ATTACHED_GLUE = 100
const PUNCH_PAUSE_SECONDS = 0.3
const LONE_PUNCH_WORD_COST = 0.5
const LONE_PUNCTUATED_WORD_COST = 1.5
const LONE_WORD_COST = 3

/** Lowercase, straight apostrophes, no edge punctuation (keeps "%" and "$"). */
function bare(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('’', "'")
    .replace(/^[^\p{L}\p{N}$%'#]+|[^\p{L}\p{N}%']+$/gu, '')
}

/** English rules apply: the transcript says so, or enough of its words are common English ones. */
export function usesEnglishPhraseRules(
  words: readonly { text: string }[],
  language?: string,
): boolean {
  const code = language?.trim().toLowerCase()
  if (code && code !== 'auto') return /^(?:en|english)(?:$|[-_])/.test(code)
  if (words.length === 0) return false
  const markers = words.filter((word) => ENGLISH_MARKERS.has(bare(word.text))).length
  return markers / words.length >= 0.12
}

/** A pause between words, scaled by its length: 0.18 s is a hint, half a second a clear break. */
export function pauseReward(gapSeconds: number): number {
  const reward = Math.min(6, Math.max(0, gapSeconds - 0.1) * 10)
  // Whisper timings are in centiseconds: no float dust from a 0.1 s gap.
  return reward < 0.01 ? 0 : -reward
}

function punctuationReward(previous: string): number {
  if (SENTENCE_END.test(previous)) return SENTENCE_END_REWARD
  if (CLAUSE_END.test(previous)) return CLAUSE_END_REWARD
  return 0
}

const isNumeric = (word: string) => HAS_DIGIT.test(word) || NUMBER_WORDS.has(word)

/** "$5 million", "10 percent", "3 days", "twenty five", "40 000". */
function numberGlue(previous: string, next: string): number {
  if (CURRENCY_ONLY.test(previous)) return NUMBER_GLUE
  if (HAS_DIGIT.test(previous) && HAS_DIGIT.test(next)) return NUMBER_GLUE
  if (isNumeric(previous) && UNITS.has(next)) return NUMBER_GLUE
  if (TENS.has(previous) && NUMBER_WORDS.has(next)) return NUMBER_GLUE
  return 0
}

/** "Tiger Woods", "New York": capitalised words in a row (not "I"). */
function nameGlue(previousText: string, nextText: string): number {
  const capitalised = (text: string) => CAPITALISED.test(text) && !I_FORMS.test(bare(text))
  return capitalised(previousText) && capitalised(nextText) ? NAME_GLUE : 0
}

const isFunctionWord = (word: string) =>
  DETERMINERS.has(word) ||
  PREPOSITIONS.has(word) ||
  CLAUSE_STARTERS.has(word) ||
  AUXILIARIES.has(word) ||
  SUBJECT_PRONOUNS.has(word) ||
  AUX_CONTRACTION.test(word)

/** A preposition before another phrase start is a particle: "pop around | to", "click around | and". */
const isParticle = (next: string) => PREPOSITIONS.has(next) || CLAUSE_STARTERS.has(next)

/** How badly `previous` wants to stay with the word after it. */
function englishGlue(previous: string, next: string): number {
  if (DETERMINERS.has(previous)) return DETERMINER_GLUE
  if (isNumeric(previous) && !isFunctionWord(next)) return QUANTITY_GLUE
  if (PREPOSITIONS.has(previous)) return isParticle(next) ? PARTICLE_GLUE : PREPOSITION_GLUE
  if (AUXILIARIES.has(previous) || AUX_CONTRACTION.test(previous)) return AUXILIARY_GLUE
  if (CLAUSE_STARTERS.has(previous)) return CONJUNCTION_GLUE
  if (SUBJECT_PRONOUNS.has(previous)) return PRONOUN_GLUE
  // An object pronoun ends its verb phrase.
  if (OBJECT_PRONOUNS.has(previous)) return 0
  if (OBJECT_PRONOUNS.has(next)) return OBJECT_GLUE
  if (STARTS_WITH_DIGIT.test(next)) return NUMBER_AFTER_GLUE
  return isFunctionWord(next) ? 0 : CONTENT_GLUE
}

/** How good a phrase start `next` is. */
function englishPhraseStart(next: string): number {
  if (CLAUSE_STARTERS.has(next)) return CLAUSE_START_REWARD
  if (DETERMINERS.has(next) || SUBJECT_PRONOUNS.has(next)) return PHRASE_START_REWARD
  return 0
}

/** Boundaries inside a fixed phrase ("a lot of", "going to"), by the index of the word after. */
function fixedPhraseBoundaries(bareWords: readonly string[]): Set<number> {
  const inside = new Set<number>()
  for (let start = 0; start < bareWords.length; start++) {
    for (const phrase of FIXED_PHRASES) {
      if (!phrase.every((word, offset) => bareWords[start + offset] === word)) continue
      for (let offset = 1; offset < phrase.length; offset++) inside.add(start + offset)
    }
  }
  return inside
}

interface BoundaryContext {
  previousText: string
  nextText: string
  previous: string
  next: string
  gap: number
}

/** English rules for a boundary with no punctuation before it. */
function englishCost(context: BoundaryContext, inFixedPhrase: boolean): number {
  const glue = Math.max(
    englishGlue(context.previous, context.next),
    nameGlue(context.previousText, context.nextText),
    inFixedPhrase ? FIXED_PHRASE_GLUE : 0,
  )
  return glue + englishPhraseStart(context.next)
}

function boundaryCost(context: BoundaryContext, english: boolean, inFixedPhrase: boolean): number {
  if (ATTACHES_LEFT.test(context.nextText)) return ATTACHED_GLUE
  const punctuated = ANY_TRAILING_PUNCTUATION.test(context.previousText)
  const rules = english && !punctuated ? englishCost(context, inFixedPhrase) : 0
  const numbers = numberGlue(context.previous, context.next)
  return punctuationReward(context.previousText) + pauseReward(context.gap) + rules + numbers
}

function contextAt(words: readonly TimedWord[], bareWords: readonly string[], k: number) {
  return {
    previousText: words[k - 1]!.text,
    nextText: words[k]!.text,
    previous: bareWords[k - 1]!,
    next: bareWords[k]!,
    gap: words[k]!.start - words[k - 1]!.end,
  }
}

const gapBefore = (words: readonly TimedWord[], k: number) =>
  k === 0 ? Infinity : words[k]!.start - words[k - 1]!.end

const endsPhrase = (text: string | undefined) =>
  text !== undefined && (SENTENCE_END.test(text) || CLAUSE_END.test(text))

/**
 * A word on its own: a punch word ("Done." between pauses), a word set off by
 * punctuation, or a word torn from its phrase.
 */
function loneWordCost(words: readonly TimedWord[], k: number): number {
  const pauseAfter = k === words.length - 1 || gapBefore(words, k + 1) >= PUNCH_PAUSE_SECONDS
  const pauseBefore = gapBefore(words, k) >= PUNCH_PAUSE_SECONDS
  const sentenceBefore = SENTENCE_END.test(words[k - 1]?.text ?? '')
  if (pauseAfter && (pauseBefore || sentenceBefore)) return LONE_PUNCH_WORD_COST
  if (endsPhrase(words[k]!.text) || endsPhrase(words[k - 1]?.text)) return LONE_PUNCTUATED_WORD_COST
  return LONE_WORD_COST
}

/**
 * Scores every boundary between `words`. `english` turns on the English
 * phrase rules; without it only punctuation, pauses and digits count.
 */
export function scoreCaptionBoundaries(
  words: readonly TimedWord[],
  english: boolean,
): CaptionBoundaries {
  const bareWords = words.map((word) => bare(word.text))
  const fixed = english ? fixedPhraseBoundaries(bareWords) : new Set<number>()
  const cost = Array.from<number>({ length: words.length + 1 }).fill(0)
  const longChunkBonus = Array.from<number>({ length: words.length + 1 }).fill(0)
  for (let k = 1; k < words.length; k++) {
    const context = contextAt(words, bareWords, k)
    cost[k] = boundaryCost(context, english, fixed.has(k))
    const prepositionStart = english && PREPOSITIONS.has(context.next) && cost[k]! < 50
    longChunkBonus[k] = prepositionStart ? PREPOSITION_REWARD : 0
  }
  return { cost, longChunkBonus, loneWordCost: words.map((_, k) => loneWordCost(words, k)) }
}
