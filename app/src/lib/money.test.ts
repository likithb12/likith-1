import { describe, expect, it } from 'vitest'
import { d, formatSigned, parseMoneyInput, percentChange, round, sum, toDb } from './money'

describe('parsing money', () => {
  it('recovers the intended decimal from a JSON number', () => {
    // PostgREST serialises numeric as a JSON number; going through the binary
    // double must not leak float error into the decimal.
    expect(d(1234.56).toFixed(2)).toBe('1234.56')
    expect(d(0.1).plus(d(0.2)).toFixed(2)).toBe('0.30')
  })

  it('treats null, undefined and empty as zero', () => {
    expect(d(null).toFixed(2)).toBe('0.00')
    expect(d(undefined).toFixed(2)).toBe('0.00')
    expect(d('').toFixed(2)).toBe('0.00')
  })

  it('does not throw on malformed input', () => {
    expect(d('abc').toFixed(2)).toBe('0.00')
    expect(d(Number.NaN).toFixed(2)).toBe('0.00')
    expect(d(Number.POSITIVE_INFINITY).toFixed(2)).toBe('0.00')
  })

  it('sums without float drift', () => {
    expect(sum(['0.1', '0.2', '0.3']).toFixed(2)).toBe('0.60')
    expect(sum(Array.from({ length: 10 }, () => '0.07')).toFixed(2)).toBe('0.70')
  })
})

describe('parseMoneyInput', () => {
  it('accepts what people actually type', () => {
    expect(parseMoneyInput('1234.56')?.toFixed(2)).toBe('1234.56')
    expect(parseMoneyInput('1,234.56')?.toFixed(2)).toBe('1234.56')
    expect(parseMoneyInput('$1,234.56')?.toFixed(2)).toBe('1234.56')
    expect(parseMoneyInput('  42 ')?.toFixed(2)).toBe('42.00')
    expect(parseMoneyInput('.5')?.toFixed(2)).toBe('0.50')
  })

  it('reads accounting negatives', () => {
    expect(parseMoneyInput('-100')?.toFixed(2)).toBe('-100.00')
    expect(parseMoneyInput('(1,234.50)')?.toFixed(2)).toBe('-1234.50')
    expect(parseMoneyInput('($50)')?.toFixed(2)).toBe('-50.00')
  })

  it('returns null rather than zero for unreadable input', () => {
    // Silently recording zero would be worse than refusing the input.
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
    expect(parseMoneyInput('.')).toBeNull()
    expect(parseMoneyInput('1.2.3')).toBeNull()
  })
})

describe('rounding and serialisation', () => {
  it('rounds half up, as a statement would', () => {
    expect(round('1.005').toFixed(2)).toBe('1.01')
    expect(round('2.675').toFixed(2)).toBe('2.68')
    expect(round('-1.005').toFixed(2)).toBe('-1.01')
  })

  it('serialises at a fixed scale for Postgres numeric', () => {
    expect(toDb('12.5')).toBe('12.50')
    expect(toDb(12)).toBe('12.00')
    expect(toDb('12.999')).toBe('13.00')
    expect(toDb('1.23456789', 6)).toBe('1.234568')
  })
})

describe('percentChange', () => {
  it('computes a signed percentage', () => {
    expect(percentChange('100', '110')?.toFixed(1)).toBe('10.0')
    expect(percentChange('100', '90')?.toFixed(1)).toBe('-10.0')
  })

  it('uses the magnitude of the base, so growth from a debt reads correctly', () => {
    // From −1000 to −500 is an improvement of 500 on a base of 1000.
    expect(percentChange('-1000', '-500')?.toFixed(1)).toBe('50.0')
  })

  it('returns null instead of infinity when the base is zero', () => {
    expect(percentChange('0', '100')).toBeNull()
  })
})

describe('formatSigned', () => {
  it('marks direction explicitly', () => {
    expect(formatSigned('100', 'AUD')).toContain('+')
    expect(formatSigned('-100', 'AUD')).toContain('−')
    expect(formatSigned('0', 'AUD')).not.toContain('+')
  })
})
