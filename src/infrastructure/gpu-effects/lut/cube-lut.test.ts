// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  MAX_EMBEDDED_LUT_SIZE,
  createIdentityLutData,
  decodeLutData,
  embedCubeLut,
  encodeLutData,
  parseCubeLut,
  readCubeLutHeader,
  resampleCubeLut,
} from './cube-lut'

describe('parseCubeLut', () => {
  it('parses a small 2^3 cube file with TITLE, comments and CRLF', () => {
    const text = [
      '# created by hand',
      'TITLE "Test LUT"',
      '',
      'LUT_3D_SIZE 2',
      '# data follows',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\r\n')

    const lut = parseCubeLut(text)
    expect(lut.title).toBe('Test LUT')
    expect(lut.size).toBe(2)
    expect(lut.data).toEqual(createIdentityLutData(2))
  })

  it('uses red-fastest ordering on an asymmetric 2^3 LUT', () => {
    // Only the value of the first column varies with the fastest axis:
    // entries alternate 0.2 / 0.8 in red, green/blue constant.
    const text = [
      'LUT_3D_SIZE 2',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
    ].join('\n')

    const lut = parseCubeLut(text)
    // Entry index = r + g*2 + b*4 (red fastest). Even indices r=0, odd r=1.
    for (let i = 0; i < 8; i++) {
      const red = lut.data[i * 4]
      expect(red).toBe(i % 2 === 0 ? Math.round(0.2 * 255) : Math.round(0.8 * 255))
      expect(lut.data[i * 4 + 1]).toBe(Math.round(0.5 * 255))
      expect(lut.data[i * 4 + 2]).toBe(Math.round(0.5 * 255))
      expect(lut.data[i * 4 + 3]).toBe(255)
    }
  })

  it('applies DOMAIN_MIN/DOMAIN_MAX normalization', () => {
    const text = [
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 2 2 2',
      '0 0 0',
      '2 0 0',
      '0 2 0',
      '2 2 0',
      '0 0 2',
      '2 0 2',
      '0 2 2',
      '1 1 1',
    ].join('\n')

    const lut = parseCubeLut(text)
    // 2 maps to 255, 1 maps to 128 (round(0.5*255))
    expect(lut.data[4]).toBe(255) // second entry red = 2 -> 255
    const last = lut.data.subarray(7 * 4, 8 * 4)
    expect(Array.from(last)).toEqual([128, 128, 128, 255])
  })

  it('supports exponent notation floats', () => {
    const text = ['LUT_3D_SIZE 2', ...Array(8).fill('5e-1 1e0 0e0')].join('\n')
    const lut = parseCubeLut(text)
    expect(lut.data[0]).toBe(128)
    expect(lut.data[1]).toBe(255)
    expect(lut.data[2]).toBe(0)
  })

  it('throws on wrong entry count', () => {
    const text = ['LUT_3D_SIZE 2', '0 0 0', '1 1 1'].join('\n')
    expect(() => parseCubeLut(text)).toThrow(/expected 8 data entries/)
  })

  it('throws on missing LUT_3D_SIZE', () => {
    expect(() => parseCubeLut('TITLE "no size"\n0 0 0\n')).toThrow(/LUT_3D_SIZE/)
  })

  it('throws on 1D LUTs', () => {
    expect(() => parseCubeLut('LUT_1D_SIZE 1024\n')).toThrow('1D LUTs are not supported')
  })
})

describe('createIdentityLutData', () => {
  it('has correct corner values for size 2', () => {
    const data = createIdentityLutData(2)
    expect(data.length).toBe(2 * 2 * 2 * 4)
    expect(Array.from(data.subarray(0, 4))).toEqual([0, 0, 0, 255])
    expect(Array.from(data.subarray(7 * 4, 8 * 4))).toEqual([255, 255, 255, 255])
  })
})

describe('resampleCubeLut', () => {
  it('resamples identity 5^3 to approximately identity 3^3', () => {
    const source = { title: null, size: 5, data: createIdentityLutData(5) }
    const resampled = resampleCubeLut(source, 3)
    expect(resampled.size).toBe(3)

    const expected = createIdentityLutData(3)
    expect(resampled.data.length).toBe(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs((resampled.data[i] ?? 0) - (expected[i] ?? 0))).toBeLessThanOrEqual(1)
    }
  })

  it('returns the same object when size <= maxSize', () => {
    const lut = { title: null, size: 3, data: createIdentityLutData(3) }
    expect(resampleCubeLut(lut, 3)).toBe(lut)
    expect(resampleCubeLut(lut, 16)).toBe(lut)
  })
})

describe('encodeLutData / decodeLutData', () => {
  it('round-trips bytes', () => {
    const data = new Uint8Array(10000)
    for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 3) % 256
    const encoded = encodeLutData(data)
    expect(typeof encoded).toBe('string')
    expect(decodeLutData(encoded)).toEqual(data)
  })
})

function identityCubeText(size: number, title?: string): string {
  const lines = title ? [`TITLE "${title}"`] : []
  lines.push(`LUT_3D_SIZE ${size}`)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        lines.push([r, g, b].map((v) => (v / (size - 1)).toFixed(4)).join(' '))
  return lines.join('\n')
}

describe('embedCubeLut', () => {
  it('embeds a small LUT as-is, named by its TITLE', () => {
    const params = embedCubeLut(identityCubeText(2, 'Neutral'), 'neutral.cube')
    expect(params).toEqual({
      lutName: 'Neutral',
      lutSize: '2',
      lutData: encodeLutData(createIdentityLutData(2)),
    })
  })

  it('falls back to the file name and resamples big LUTs to the embedded size', () => {
    const params = embedCubeLut(identityCubeText(MAX_EMBEDDED_LUT_SIZE + 4), 'Big Look.CUBE')
    expect(params.lutName).toBe('Big Look')
    expect(params.lutSize).toBe(String(MAX_EMBEDDED_LUT_SIZE))
    expect(decodeLutData(params.lutData)).toHaveLength(MAX_EMBEDDED_LUT_SIZE ** 3 * 4)
  })
})

describe('readCubeLutHeader', () => {
  it('reads TITLE and LUT_3D_SIZE without the data', () => {
    expect(readCubeLutHeader(identityCubeText(3, 'Warm'))).toEqual({ title: 'Warm', size: 3 })
  })

  it('has no size for a 1D LUT or a file without a header', () => {
    expect(readCubeLutHeader('LUT_1D_SIZE 4\n0 0 0\n')).toEqual({ title: null, size: null })
    expect(readCubeLutHeader('0 0 0\nLUT_3D_SIZE 2')).toEqual({ title: null, size: null })
  })
})
