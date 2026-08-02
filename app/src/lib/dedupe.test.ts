import { describe, expect, it } from 'vitest'
import {
  assignDedupeHashes,
  countExistingByBaseHash,
  dedupeBaseHash,
  dedupePayload,
  normaliseDescription,
} from './dedupe'

const USER = '00000000-0000-0000-0000-000000000001'

interface Row {
  date: string
  amount: string
  description: string
}

const toParts = (row: Row) => ({
  userId: USER,
  accountId: 'acct-1',
  txnDate: row.date,
  amount: row.amount,
  descriptionRaw: row.description,
})

describe('normaliseDescription', () => {
  it('ignores case, padding and punctuation', () => {
    expect(normaliseDescription('  WOOLWORTHS 1234  ')).toBe('woolworths 1234')
    expect(normaliseDescription('Woolworths/1234')).toBe('woolworths 1234')
    expect(normaliseDescription('WOOLWORTHS   1234')).toBe('woolworths 1234')
  })

  it('handles null and empty input', () => {
    expect(normaliseDescription(null)).toBe('')
    expect(normaliseDescription('')).toBe('')
    expect(normaliseDescription('!!!')).toBe('')
  })
})

describe('dedupe hashing', () => {
  it('hashes the fields named in the spec, in order', () => {
    expect(dedupePayload(toParts({ date: '2026-06-01', amount: '12.5', description: 'Cafe X' }))).toBe(
      `${USER}|acct-1|2026-06-01|12.50|cafe x`,
    )
  })

  it('is stable for the same transaction', async () => {
    const row = { date: '2026-06-01', amount: '12.50', description: 'Cafe X' }
    expect(await dedupeBaseHash(toParts(row))).toBe(await dedupeBaseHash(toParts(row)))
  })

  it('normalises the amount, so 12.5 and 12.50 collide', async () => {
    const a = await dedupeBaseHash(toParts({ date: '2026-06-01', amount: '12.5', description: 'X' }))
    const b = await dedupeBaseHash(toParts({ date: '2026-06-01', amount: '12.50', description: 'X' }))
    expect(a).toBe(b)
  })

  it('differs when any component differs', async () => {
    const base = { date: '2026-06-01', amount: '12.50', description: 'Cafe X' }
    const baseHash = await dedupeBaseHash(toParts(base))

    expect(await dedupeBaseHash(toParts({ ...base, date: '2026-06-02' }))).not.toBe(baseHash)
    expect(await dedupeBaseHash(toParts({ ...base, amount: '12.51' }))).not.toBe(baseHash)
    expect(await dedupeBaseHash(toParts({ ...base, description: 'Cafe Y' }))).not.toBe(baseHash)
    expect(
      await dedupeBaseHash({ ...toParts(base), accountId: 'acct-2' }),
    ).not.toBe(baseHash)
    expect(await dedupeBaseHash({ ...toParts(base), userId: 'other' })).not.toBe(baseHash)
  })

  it('produces a 64-character hex digest', async () => {
    const hash = await dedupeBaseHash(toParts({ date: '2026-06-01', amount: '1', description: 'a' }))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('re-importing an overlapping statement', () => {
  const statement: Row[] = [
    { date: '2026-06-01', amount: '12.50', description: 'CAFE X' },
    { date: '2026-06-02', amount: '80.00', description: 'WOOLWORTHS 1234' },
    { date: '2026-06-03', amount: '25.00', description: 'FUEL' },
  ]

  it('imports every row on a first import', async () => {
    const hashed = await assignDedupeHashes(statement, toParts)
    expect(hashed.filter((h) => h.isDuplicate)).toHaveLength(0)
  })

  it('detects every row as a duplicate on a second import of the same file', async () => {
    const first = await assignDedupeHashes(statement, toParts)
    const stored = countExistingByBaseHash(first.map((h) => h.dedupeHash))

    const second = await assignDedupeHashes(statement, toParts, stored)
    expect(second.every((h) => h.isDuplicate)).toBe(true)
  })

  it('imports only the new rows from an overlapping period', async () => {
    const first = await assignDedupeHashes(statement, toParts)
    const stored = countExistingByBaseHash(first.map((h) => h.dedupeHash))

    const overlapping = [
      ...statement.slice(1),
      { date: '2026-06-04', amount: '9.99', description: 'SPOTIFY' },
    ]
    const second = await assignDedupeHashes(overlapping, toParts, stored)

    expect(second.filter((h) => !h.isDuplicate).map((h) => (h.row as Row).description)).toEqual([
      'SPOTIFY',
    ])
  })

  it('survives cosmetic differences between two exports of the same statement', async () => {
    const first = await assignDedupeHashes(statement, toParts)
    const stored = countExistingByBaseHash(first.map((h) => h.dedupeHash))

    const reformatted: Row[] = [
      { date: '2026-06-01', amount: '12.5', description: 'cafe  x' },
      { date: '2026-06-02', amount: '80.000', description: 'Woolworths/1234' },
      { date: '2026-06-03', amount: '25.00', description: ' FUEL ' },
    ]
    const second = await assignDedupeHashes(reformatted, toParts, stored)
    expect(second.every((h) => h.isDuplicate)).toBe(true)
  })
})

describe('genuinely repeated transactions', () => {
  // Two identical coffees on the same day are two transactions, not one. The
  // bare spec hash would silently drop the second.
  const twoCoffees: Row[] = [
    { date: '2026-06-01', amount: '4.50', description: 'CAFE X' },
    { date: '2026-06-01', amount: '4.50', description: 'CAFE X' },
  ]

  it('imports both on a first import', async () => {
    const hashed = await assignDedupeHashes(twoCoffees, toParts)
    expect(hashed.filter((h) => h.isDuplicate)).toHaveLength(0)
    expect(new Set(hashed.map((h) => h.dedupeHash)).size).toBe(2)
  })

  it('treats both as duplicates when the same file is imported twice', async () => {
    const first = await assignDedupeHashes(twoCoffees, toParts)
    const stored = countExistingByBaseHash(first.map((h) => h.dedupeHash))

    const second = await assignDedupeHashes(twoCoffees, toParts, stored)
    expect(second.every((h) => h.isDuplicate)).toBe(true)
  })

  it('imports only the extra repeat when a later statement has three', async () => {
    const first = await assignDedupeHashes(twoCoffees, toParts)
    const stored = countExistingByBaseHash(first.map((h) => h.dedupeHash))

    const threeCoffees = [...twoCoffees, { date: '2026-06-01', amount: '4.50', description: 'CAFE X' }]
    const second = await assignDedupeHashes(threeCoffees, toParts, stored)

    expect(second.filter((h) => !h.isDuplicate)).toHaveLength(1)
    expect(second.filter((h) => !h.isDuplicate)[0]?.occurrence).toBe(2)
  })
})

describe('countExistingByBaseHash', () => {
  it('counts occurrences per base hash', () => {
    expect(countExistingByBaseHash(['aaa:0', 'aaa:1', 'bbb:0'])).toEqual({ aaa: 2, bbb: 1 })
  })

  it('tolerates hashes stored without an occurrence suffix', () => {
    expect(countExistingByBaseHash(['aaa'])).toEqual({ aaa: 1 })
  })
})
