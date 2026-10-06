import { describe, expect, it } from 'vite-plus/test'
import { encoderDelayFromImpulse, locateImpulse } from './audio-encoder-delay'

describe('audio encoder delay', () => {
  it('reads the delay from where the decoded impulse lands', () => {
    const decoded = new Float32Array(20_000)
    decoded[4800 + 2112] = -0.85 // AAC may flip or scale the impulse a little
    decoded[4800 + 2113] = 0.3
    expect(encoderDelayFromImpulse(locateImpulse(decoded))).toBe(2112)
  })

  it('reports no delay when the impulse is missing or implausible', () => {
    expect(encoderDelayFromImpulse(locateImpulse(new Float32Array(20_000).fill(0.05)))).toBeNull()
    const early = new Float32Array(20_000)
    early[100] = 0.9
    expect(encoderDelayFromImpulse(locateImpulse(early))).toBeNull()
  })
})
