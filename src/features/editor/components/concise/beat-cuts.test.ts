import { describe, expect, it } from 'vitest'
import { describeOutPoint, planCutIn, planCutOut } from './beat-cuts'

const beats = [0, 15, 30.4, 45, 60]

describe('beat cuts', () => {
  it('cuts out to the first beat after the end', () => {
    expect(planCutOut(beats, 20)).toEqual({ beatFrame: 30, amount: 10 })
    expect(planCutOut(beats, 30)).toEqual({ beatFrame: 45, amount: 15 })
    expect(planCutOut(beats, 60)).toBeNull()
  })

  it('cuts in to the nearest beat before the start', () => {
    expect(planCutIn(beats, 40)).toEqual({ beatFrame: 30, amount: -10 })
    expect(planCutIn(beats, 15)).toEqual({ beatFrame: 0, amount: -15 })
    expect(planCutIn(beats, 0)).toBeNull()
  })

  it('reads the out point against the nearest beat', () => {
    expect(describeOutPoint(beats, 32, 30)).toEqual({
      ms: 53,
      direction: 'after',
      beatSeconds: 30.4 / 30,
    })
    expect(describeOutPoint(beats, 44, 30)?.direction).toBe('before')
    expect(describeOutPoint(beats, 45, 30)).toMatchObject({ ms: 0, direction: 'on' })
    expect(describeOutPoint([], 45, 30)).toBeNull()
  })
})
