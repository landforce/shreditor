import { describe, expect, it } from 'vite-plus/test'
import type { MediaTranscriptSegment, MediaTranscriptWord } from '@/types/storage'
import {
  DEFAULT_CAPTION_CHUNK_LIMITS,
  breakCaptionLines,
  chunkTranscriptForCaptions,
  type CaptionChunkLimits,
} from './caption-chunking'

/**
 * Word timings the way whisper.cpp gives them: about 70 ms a character plus a
 * little, 60 ms between words, and `[0.6]` for a pause of that many seconds.
 */
function speak(script: string, start = 0.2): MediaTranscriptWord[] {
  const words: MediaTranscriptWord[] = []
  let time = start
  for (const token of script.split(/\s+/)) {
    const pause = /^\[(\d+(?:\.\d+)?)\]$/.exec(token)
    if (pause) {
      time += Number(pause[1])
      continue
    }
    const end = Number((time + 0.12 + token.length * 0.045).toFixed(3))
    words.push({ text: token, start: Number(time.toFixed(3)), end })
    time = end + 0.06
  }
  return words
}

const segment = (words: MediaTranscriptWord[]): MediaTranscriptSegment => ({
  text: words.map((word) => word.text).join(' '),
  start: words[0]!.start,
  end: words.at(-1)!.end,
  words,
})

/** A creator kit's 2-3 words a chunk, one line. */
const KIT: CaptionChunkLimits = {
  ...DEFAULT_CAPTION_CHUNK_LIMITS,
  maxWords: 3,
  minWords: 2,
  maxCharsPerLine: 23,
  minSeconds: 0.3,
}

const texts = (script: string, limits: CaptionChunkLimits = KIT) =>
  chunkTranscriptForCaptions([segment(speak(script))], limits).map((chunk) => chunk.text)

describe('chunkTranscriptForCaptions by phrase', () => {
  it('breaks a sentence the way an editor would', () => {
    expect(texts("I'm buying a warehouse and I'm going to put a golf course inside it.")).toEqual([
      "I'm buying",
      'a warehouse',
      "and I'm going",
      'to put',
      'a golf course',
      'inside it.',
    ])
  })

  it('never breaks after an article, a preposition or between "is" and its verb', () => {
    const chunks = texts(
      'The tool that it built lets me pop around to different viewpoints and it is going to save us a lot of time on the course.',
      { ...KIT, maxWords: 4 },
    )
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/\b(?:a|an|the|to|of|on|is)$/i)
    }
    expect(chunks.join(' / ')).toContain('a lot of time')
  })

  it('keeps numbers with their units', () => {
    const chunks = texts('We spent $5 million in 3 days and grew 10 percent.')
    expect(chunks.join(' / ')).toMatch(/\$5 million/)
    expect(chunks.join(' / ')).toMatch(/3 days/)
    expect(chunks.join(' / ')).toMatch(/10 percent\./)
    expect(texts('it cost me $40,000 to build.')).toEqual(['it cost me', '$40,000 to build.'])
  })

  it('keeps a name together', () => {
    expect(texts('Tiger Woods would love this.')).toEqual(['Tiger Woods', 'would love this.'])
    expect(texts('I met Tiger Woods at the range.')).toEqual([
      'I met',
      'Tiger Woods',
      'at the range.',
    ])
  })

  it('breaks at a long pause mid-sentence', () => {
    expect(texts('I think [0.6] we should go home now.', DEFAULT_CAPTION_CHUNK_LIMITS)).toEqual([
      'I think',
      'we should go home now.',
    ])
  })

  it('lets a punch word set off by pauses stand alone, and only that', () => {
    expect(texts('We finished the whole build. [0.5] Done. [0.6] Now we test.')).toEqual([
      'We finished',
      'the whole build.',
      'Done.',
      'Now we test.',
    ])
    for (const chunk of texts('So it made this and this and that is all it made for us.')) {
      expect(chunk.split(' ').length).toBeGreaterThanOrEqual(2)
    }
  })

  it('ends chunks at sentence ends', () => {
    expect(texts('This is insane. This is insane.', DEFAULT_CAPTION_CHUNK_LIMITS)).toEqual([
      'This is insane.',
      'This is insane.',
    ])
    expect(
      texts(
        'Check this out. So I uploaded a floor plan and this image.',
        DEFAULT_CAPTION_CHUNK_LIMITS,
      )[0],
    ).toBe('Check this out.')
  })

  it('keeps every chunk within the characters a line holds', () => {
    const limits = { ...DEFAULT_CAPTION_CHUNK_LIMITS, maxCharsPerLine: 14 }
    const chunks = texts('An incredible indoor-outdoor putting green for the whole family.', limits)
    for (const chunk of chunks) {
      if (chunk.includes(' ')) expect(chunk.length).toBeLessThanOrEqual(14)
    }
    expect(chunks.join(' ')).toBe(
      'An incredible indoor-outdoor putting green for the whole family.',
    )
  })

  it('honours the fewest words a chunk should have', () => {
    const limits = { ...KIT, maxWords: 4, minWords: 3, maxCharsPerLine: 40 }
    const chunks = texts(
      'So I uploaded a floor plan and this image and said design an incredible golf course.',
      limits,
    )
    for (const chunk of chunks) expect(chunk.split(' ').length).toBeGreaterThanOrEqual(3)
  })

  it('never splits a word from punctuation whisper gave as its own token', () => {
    const words = speak('Hello , world . It is me .')
    const chunks = chunkTranscriptForCaptions([segment(words)], { ...KIT, maxWords: 2 })
    for (const chunk of chunks) expect(chunk.text).not.toMatch(/^[,.]/)
    expect(chunks.map((chunk) => chunk.text)).toEqual(['Hello,', 'world.', 'It is', 'me.'])
  })

  it('falls back to punctuation and pauses for other languages', () => {
    // English rules would keep "a" with "poner" and "un" with "campo".
    const spanish = 'Voy a [0.4] poner un campo, de golf dentro.'
    const limits = { ...KIT, language: 'es' }
    expect(texts(spanish, limits)).toEqual(['Voy a', 'poner un campo,', 'de golf dentro.'])
    // Detected without a language: few common English words.
    expect(texts(spanish)).toEqual(['Voy a', 'poner un campo,', 'de golf dentro.'])
  })

  it('fills chunks to the word limit with breakOn "words"', () => {
    const limits: CaptionChunkLimits = { ...KIT, breakOn: 'words' }
    expect(texts("I'm buying a warehouse and I'm going to put a golf course.", limits)).toEqual([
      "I'm buying a",
      "warehouse and I'm",
      'going to put',
      'a golf course.',
    ])
  })
})

describe('chunkTranscriptForCaptions timing', () => {
  const words = speak(
    "So I'm buying a warehouse and I asked ChatGPT to design a golf course to fit inside. [0.4] Then it estimated it cost between 160 and 200k to build.",
  )
  const chunks = chunkTranscriptForCaptions([segment(words)])

  it('runs each chunk from its first word to its last, in order, never overlapping', () => {
    expect(chunks.flatMap((chunk) => chunk.words)).toEqual(words)
    chunks.forEach((chunk, index) => {
      expect(chunk.start).toBe(chunk.words![0]!.start)
      expect(chunk.end).toBe(chunk.words!.at(-1)!.end)
      const next = chunks[index + 1]
      if (next) expect(chunk.end).toBeLessThanOrEqual(next.start)
    })
  })

  it('changes only where the default captions break', () => {
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "So I'm buying a warehouse",
      'and I asked ChatGPT',
      'to design a golf course',
      'to fit inside.',
      'Then it estimated it cost',
      'between 160 and 200k to build.',
    ])
  })

  it('passes segments without word timing through whole', () => {
    const plain = { text: ' Hello there ', start: 1, end: 2 }
    expect(chunkTranscriptForCaptions([plain])).toEqual([{ text: 'Hello there', start: 1, end: 2 }])
    expect(
      chunkTranscriptForCaptions([plain, segment(speak('Later on.', 3))]).map((c) => c.text),
    ).toEqual(['Hello there', 'Later on.'])
  })

  it('handles one word a chunk and long transcripts', () => {
    const one = chunkTranscriptForCaptions([segment(words)], { ...KIT, maxWords: 1 })
    expect(one).toHaveLength(words.length)
    const long = speak(Array.from({ length: 400 }, () => 'and then we built it.').join(' '))
    const longChunks = chunkTranscriptForCaptions([segment(long)])
    expect(longChunks.flatMap((chunk) => chunk.words)).toHaveLength(long.length)
  })
})

describe('breakCaptionLines', () => {
  const lines = (script: string, maxChars: number, english = true) => {
    const words = speak(script)
    return breakCaptionLines(
      words,
      words.map((word) => word.text),
      maxChars,
      english,
    )
  }

  it('keeps one line when the text fits', () => {
    expect(lines('a golf course', 20)).toEqual(['a golf course'])
  })

  it('wraps at the best phrase boundary with balanced lines', () => {
    // Greedy: "I asked ChatGPT to" / "design a golf course".
    expect(lines('I asked ChatGPT to design a golf course', 24)).toEqual([
      'I asked ChatGPT',
      'to design a golf course',
    ])
    // Greedy: "It made this 3D model that" / "I can click around".
    expect(lines('It made this 3D model that I can click around', 26)).toEqual([
      'It made this 3D model',
      'that I can click around',
    ])
  })

  it('balances lines without phrase rules', () => {
    expect(lines('uno dos tres cuatro cinco seis', 18, false)).toEqual([
      'uno dos tres',
      'cuatro cinco seis',
    ])
  })

  it('keeps a word longer than a line on its own line', () => {
    expect(lines('indoor-outdoor-putting-green here', 10)).toEqual([
      'indoor-outdoor-putting-green',
      'here',
    ])
  })
})
