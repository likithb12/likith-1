import { describe, expect, it } from 'vitest'
import { FxTable, convert } from './fx'

describe('FX conversion', () => {
  const table = new FxTable([
    { base_currency: 'USD', quote_currency: 'AUD', as_at: '2026-06-01', rate: '1.50000000' },
    { base_currency: 'USD', quote_currency: 'AUD', as_at: '2026-06-30', rate: '1.52000000' },
    { base_currency: 'EUR', quote_currency: 'USD', as_at: '2026-06-30', rate: '1.10000000' },
  ])

  it('returns the amount unchanged for the same currency', () => {
    const result = convert('100.00', 'AUD', 'AUD', '2026-06-30', table)
    expect(result.amount.toFixed(2)).toBe('100.00')
    expect(result.path).toBe('identity')
    expect(result.isStale).toBe(false)
    expect(result.missing).toBe(false)
  })

  it('applies a direct rate', () => {
    const result = convert('100.00', 'USD', 'AUD', '2026-06-30', table)
    expect(result.amount.toFixed(2)).toBe('152.00')
    expect(result.path).toBe('direct')
    expect(result.isStale).toBe(false)
  })

  it('applies the reciprocal when only the opposite pair is stored', () => {
    const result = convert('152.00', 'AUD', 'USD', '2026-06-30', table)
    expect(result.amount.toFixed(2)).toBe('100.00')
    expect(result.path).toBe('inverse')
  })

  it('uses the most recent prior rate and flags it as stale', () => {
    const result = convert('100.00', 'USD', 'AUD', '2026-06-15', table)
    expect(result.amount.toFixed(2)).toBe('150.00')
    expect(result.rateDate).toBe('2026-06-01')
    expect(result.isStale).toBe(true)
    expect(result.staleDays).toBe(14)
  })

  it('never uses a rate from after the requested date when a prior one exists', () => {
    const result = convert('100.00', 'USD', 'AUD', '2026-06-29', table)
    expect(result.rateDate).toBe('2026-06-01')
  })

  it('falls back to the earliest later rate when no prior rate exists, flagged', () => {
    const result = convert('100.00', 'USD', 'AUD', '2026-01-01', table)
    expect(result.rateDate).toBe('2026-06-01')
    expect(result.isStale).toBe(true)
    // Negative staleDays distinguishes "rate from the future" from "old rate".
    expect(result.staleDays).toBeLessThan(0)
    expect(result.missing).toBe(false)
  })

  it('triangulates through a pivot currency', () => {
    // EUR→USD 1.10, USD→AUD 1.52 ⇒ EUR→AUD 1.672
    const result = convert('100.00', 'EUR', 'AUD', '2026-06-30', table)
    expect(result.path).toBe('triangulated')
    expect(result.amount.toFixed(2)).toBe('167.20')
  })

  it('passes the amount through and marks it missing when no path exists', () => {
    const result = convert('100.00', 'JPY', 'AUD', '2026-06-30', table)
    expect(result.amount.toFixed(2)).toBe('100.00')
    expect(result.missing).toBe(true)
    expect(result.isStale).toBe(true)
  })

  it('round-trips without drift', () => {
    const there = convert('1234.56', 'USD', 'AUD', '2026-06-30', table)
    const back = convert(there.amount, 'AUD', 'USD', '2026-06-30', table)
    expect(back.amount.toFixed(2)).toBe('1234.56')
  })

  it('ignores non-positive and malformed rates', () => {
    const broken = new FxTable([
      { base_currency: 'USD', quote_currency: 'AUD', as_at: '2026-06-30', rate: '0' },
      { base_currency: 'GBP', quote_currency: 'AUD', as_at: '2026-06-30', rate: 'not-a-number' },
    ])
    expect(convert('10', 'USD', 'AUD', '2026-06-30', broken).missing).toBe(true)
    expect(convert('10', 'GBP', 'AUD', '2026-06-30', broken).missing).toBe(true)
  })

  it('normalises currency code case and whitespace', () => {
    const result = convert('100.00', ' usd ', 'aud', '2026-06-30', table)
    expect(result.amount.toFixed(2)).toBe('152.00')
  })

  it('prefers whichever quote is closer to the requested date', () => {
    const mixed = new FxTable([
      { base_currency: 'USD', quote_currency: 'AUD', as_at: '2026-01-01', rate: '1.40' },
      { base_currency: 'AUD', quote_currency: 'USD', as_at: '2026-06-25', rate: '0.65' },
    ])
    const result = convert('100.00', 'USD', 'AUD', '2026-06-30', mixed)
    expect(result.path).toBe('inverse')
    expect(result.rateDate).toBe('2026-06-25')
  })

  it('handles an empty table without throwing', () => {
    const empty = new FxTable()
    expect(convert('10', 'USD', 'AUD', '2026-06-30', empty).missing).toBe(true)
    expect(convert('10', 'AUD', 'AUD', '2026-06-30', empty).missing).toBe(false)
  })
})
