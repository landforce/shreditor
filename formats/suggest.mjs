// Suggest a format from cataloged footage, per the decision guide
// (formats/choosing.md, "Choose the format"). A suggestion only: the agent
// proposes it with the reason and the user decides.
import { getFormat } from './registry.mjs'

/** Share of strongly green pixels above which a talking head counts as shot on a green screen. */
const GREEN_SCREEN_SHARE = 0.25

const hasSpeech = (entry) => Boolean(entry.speech) || entry.category === 'voiceover'
const keyed = (entry) => Boolean(entry.alpha) || (entry.greenShare ?? 0) >= GREEN_SCREEN_SHARE

// What each entry is for the decision guide, first match wins. A category the
// agent has set decides; otherwise the probe (kind, speech) does.
const KINDS = [
  ['talkingHeads', (e) => e.category === 'speaker' || (e.kind === 'video' && hasSpeech(e))],
  ['voiceovers', (e) => e.category === 'voiceover' || (e.kind === 'audio' && hasSpeech(e))],
  ['music', (e) => e.category === 'music' || (e.kind === 'audio' && !e.category)],
  ['broll', (e) => e.category === 'b-roll' || (e.kind === 'video' && !e.category)],
  ['stills', (e) => e.kind === 'image' || e.category === 'graphics'],
]

function footageSignals(entries) {
  const signals = { talkingHeads: 0, keyed: 0, voiceovers: 0, broll: 0, stills: 0, music: 0 }
  for (const entry of entries.filter((e) => !e.error)) {
    const match = KINDS.find(([, test]) => test(entry))
    if (match) signals[match[0]] += 1
    if (match?.[0] === 'talkingHeads' && keyed(entry)) signals.keyed += 1
  }
  return signals
}

const pick = (id, reason, alternatives = []) => ({
  id,
  name: getFormat(id).name,
  reason,
  alternatives,
})

// The decision guide's table, in order: the first rule that applies wins.
const RULES = [
  (s) =>
    s.voiceovers > 0 && s.broll > 0
      ? pick('vlog', `voiceover (${s.voiceovers}) narrating over b-roll (${s.broll})`)
      : null,
  (s) =>
    s.keyed > 0
      ? pick('greenscreen', `talking head on a green screen (${s.keyed} keyed clip(s))`)
      : null,
  (s) => {
    if (!s.talkingHeads) return null
    const reason = `talking head in a real setting (${s.talkingHeads} clip(s) with speech)`
    if (!s.broll) return pick('graphic-yap', reason)
    return pick(
      'graphic-yap',
      `${reason}; if the voice runs over the b-roll most of the time, Vlog`,
      ['vlog'],
    )
  },
  (s) => {
    if (!s.broll) return null
    const music = s.music > 0 ? `, music (${s.music})` : ', no music yet (pick a track)'
    return pick('ten-shot', `b-roll with nobody talking (${s.broll} clip(s))${music}`)
  },
]

/**
 * { id, name, reason, alternatives, signals } or null when nothing points
 * anywhere. Entries are catalog entries: kind video|image|audio, speech text or
 * null, alpha, greenShare (0-1, share of strongly green pixels), and category
 * once the agent has set it.
 */
export function suggestFormat(entries) {
  const signals = footageSignals(entries)
  for (const rule of RULES) {
    const suggestion = rule(signals)
    if (suggestion) return { ...suggestion, signals }
  }
  return null
}
