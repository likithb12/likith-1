import { describe, expect, it } from 'vitest'
import { AU_BANK_PROFILES, mapRows, parseWithProfile, type MappingProfile } from './importer'
import { assignDedupeHashes, countExistingByBaseHash } from './dedupe'
import type { DraftTransaction } from './importer'

/**
 * Phase 2 exit criterion: importing a real bank CSV twice must leave no
 * duplicates.
 *
 * This drives the whole pipeline — parse, map, hash, compare — the same way
 * the import wizard does, with the database stood in for by a list of stored
 * hashes. It is the test that would catch a regression in any one of those
 * stages combining into silent duplication.
 */

const USER = '00000000-0000-0000-0000-000000000001'
const ACCOUNT = 'acct-cba-1'

const cba = AU_BANK_PROFILES[0]!
const westpac = AU_BANK_PROFILES[3]!

/** A CBA-shaped export, including two identical same-day coffees. */
const STATEMENT_JUNE = `Date,Amount,Description,Balance
01/06/2026,-4.50,"CAFE ROSSO SYDNEY",5495.50
01/06/2026,-4.50,"CAFE ROSSO SYDNEY",5491.00
02/06/2026,-142.30,"WOOLWORTHS 1234 NEWTOWN",5348.70
03/06/2026,-89.00,"AGL ENERGY",5259.70
05/06/2026,2500.00,"SALARY ACME PTY LTD",7759.70
09/06/2026,-19.99,"SPOTIFY P1A2B3C4",7739.71
15/06/2026,-1250.00,"RENT TRANSFER",6489.71
`

/** Overlaps the last three days of June and continues into July. */
const STATEMENT_JULY = `Date,Amount,Description,Balance
09/06/2026,-19.99,"SPOTIFY P1A2B3C4",7739.71
15/06/2026,-1250.00,"RENT TRANSFER",6489.71
02/07/2026,-156.80,"WOOLWORTHS 1234 NEWTOWN",6332.91
05/07/2026,2500.00,"SALARY ACME PTY LTD",8832.91
`

interface Stored {
  hashes: string[]
}

/** Run one import against a mutable store, exactly as the wizard does. */
async function importOnce(
  csv: string,
  store: Stored,
  profile: MappingProfile = cba,
): Promise<{ imported: DraftTransaction[]; skipped: DraftTransaction[]; failed: number }> {
  const parsed = parseWithProfile(csv, profile)
  const { drafts, errors } = mapRows(parsed, profile)

  const counts = countExistingByBaseHash(store.hashes)
  const hashed = await assignDedupeHashes(
    drafts,
    (draft) => ({
      userId: USER,
      accountId: ACCOUNT,
      txnDate: draft.txn_date,
      amount: draft.amount,
      descriptionRaw: draft.description_raw,
    }),
    counts,
  )

  const fresh = hashed.filter((entry) => !entry.isDuplicate)
  // Only newly imported rows are persisted, which is what the commit does.
  store.hashes.push(...fresh.map((entry) => entry.dedupeHash))

  return {
    imported: fresh.map((entry) => entry.row),
    skipped: hashed.filter((entry) => entry.isDuplicate).map((entry) => entry.row),
    failed: errors.length,
  }
}

describe('importing the same statement twice', () => {
  it('imports every row the first time', async () => {
    const store: Stored = { hashes: [] }
    const first = await importOnce(STATEMENT_JUNE, store)

    expect(first.imported).toHaveLength(7)
    expect(first.skipped).toHaveLength(0)
    expect(first.failed).toBe(0)
  })

  it('imports nothing the second time', async () => {
    const store: Stored = { hashes: [] }
    await importOnce(STATEMENT_JUNE, store)
    const second = await importOnce(STATEMENT_JUNE, store)

    expect(second.imported).toHaveLength(0)
    expect(second.skipped).toHaveLength(7)
    expect(store.hashes).toHaveLength(7)
  })

  it('still holds after a third and fourth import', async () => {
    const store: Stored = { hashes: [] }
    await importOnce(STATEMENT_JUNE, store)
    await importOnce(STATEMENT_JUNE, store)
    await importOnce(STATEMENT_JUNE, store)
    const fourth = await importOnce(STATEMENT_JUNE, store)

    expect(fourth.imported).toHaveLength(0)
    expect(store.hashes).toHaveLength(7)
    expect(new Set(store.hashes).size).toBe(7)
  })

  it('keeps both of two identical same-day transactions', async () => {
    // Two $4.50 coffees at the same cafe on the same day are two real
    // transactions. The spec's bare hash would drop the second.
    const store: Stored = { hashes: [] }
    const first = await importOnce(STATEMENT_JUNE, store)

    const coffees = first.imported.filter((draft) => draft.description_raw.includes('CAFE ROSSO'))
    expect(coffees).toHaveLength(2)

    const second = await importOnce(STATEMENT_JUNE, store)
    expect(second.imported).toHaveLength(0)
  })
})

describe('importing an overlapping statement', () => {
  it('imports only the rows not already present', async () => {
    const store: Stored = { hashes: [] }
    await importOnce(STATEMENT_JUNE, store)
    const july = await importOnce(STATEMENT_JULY, store)

    expect(july.imported.map((draft) => draft.txn_date)).toEqual(['2026-07-02', '2026-07-05'])
    expect(july.skipped).toHaveLength(2)
    expect(store.hashes).toHaveLength(9)
  })

  it('is stable when the overlapping statement is re-imported too', async () => {
    const store: Stored = { hashes: [] }
    await importOnce(STATEMENT_JUNE, store)
    await importOnce(STATEMENT_JULY, store)
    const again = await importOnce(STATEMENT_JULY, store)

    expect(again.imported).toHaveLength(0)
    expect(store.hashes).toHaveLength(9)
  })

  it('does not confuse a recurring identical charge in a later month', async () => {
    // Same merchant, same amount, different month — a real second charge.
    const store: Stored = { hashes: [] }
    await importOnce(STATEMENT_JUNE, store)
    const august = await importOnce(
      `Date,Amount,Description,Balance\n09/08/2026,-19.99,"SPOTIFY P1A2B3C4",100.00\n`,
      store,
    )
    expect(august.imported).toHaveLength(1)
  })
})

describe('the same statement re-exported in a different shape', () => {
  it('still detects duplicates despite cosmetic differences', async () => {
    const store: Stored = { hashes: [] }
    await importOnce(STATEMENT_JUNE, store)

    // Same transactions: unpadded amounts, different spacing and punctuation
    // in descriptions, and a preamble the bank sometimes includes.
    const reexported = `Account 06 2026
Generated 01/07/2026

Date,Amount,Description,Balance
01/06/2026,-4.5,"Cafe  Rosso, Sydney",5495.5
01/06/2026,-4.5,"Cafe  Rosso, Sydney",5491
02/06/2026,-142.3,"Woolworths/1234 Newtown",5348.7
03/06/2026,-89,"AGL Energy",5259.7
05/06/2026,2500,"Salary - ACME Pty Ltd",7759.7
09/06/2026,-19.99,"Spotify P1A2B3C4",7739.71
15/06/2026,-1250,"Rent Transfer",6489.71
`
    const second = await importOnce(reexported, { ...store, hashes: store.hashes }, { ...cba, skip_rows: 3 })

    expect(second.imported).toHaveLength(0)
    expect(second.skipped).toHaveLength(7)
  })
})

describe('a different bank format for the same account', () => {
  it('matches rows that describe the same transactions', async () => {
    const store: Stored = { hashes: [] }
    await importOnce(
      `Date,Amount,Description,Balance\n02/06/2026,-142.30,"WOOLWORTHS 1234 NEWTOWN",1.00\n`,
      store,
    )

    // Westpac-shaped export of the same transaction: separate debit column,
    // "Narrative" instead of "Description".
    const westpacCsv = `Date,Narrative,Debit Amount,Credit Amount\n02/06/2026,"WOOLWORTHS 1234 NEWTOWN",142.30,\n`
    const second = await importOnce(westpacCsv, store, westpac)

    expect(second.imported).toHaveLength(0)
    expect(second.skipped).toHaveLength(1)
  })
})
