import { toDb } from './money'
import type { ISODate } from './dates'

/**
 * Transaction de-duplication.
 *
 * Base hash is exactly as specified: SHA-256 of
 *   user_id | account_id | txn_date | amount | normalised(description_raw)
 *
 * The stored `dedupe_hash` appends an occurrence index — see
 * `assignDedupeHashes` for why. DECISIONS.md records the reasoning.
 */

export interface DedupeParts {
  userId: string
  accountId: string | null
  txnDate: ISODate
  /** Signed or unsigned; normalised to a fixed 2dp string before hashing. */
  amount: string | number
  descriptionRaw: string | null
}

/**
 * Normalise a bank description so cosmetic differences between two exports of
 * the same statement do not defeat the hash. Case, padding, punctuation and
 * repeated whitespace all vary between a bank's CSV and its re-export.
 */
export function normaliseDescription(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The spec's hash, over the canonicalised field list. */
export function dedupePayload(parts: DedupeParts): string {
  return [
    parts.userId,
    parts.accountId ?? '',
    parts.txnDate,
    toDb(parts.amount),
    normaliseDescription(parts.descriptionRaw),
  ].join('|')
}

export async function dedupeBaseHash(parts: DedupeParts): Promise<string> {
  return sha256Hex(dedupePayload(parts))
}

export interface OccurrenceCounts {
  /** How many rows with this base hash already exist for the user. */
  [baseHash: string]: number
}

export interface HashedRow<T> {
  row: T
  baseHash: string
  /** `${baseHash}:${occurrence}` — what goes in the `dedupe_hash` column. */
  dedupeHash: string
  occurrence: number
  isDuplicate: boolean
}

/**
 * Assign final dedupe hashes to a batch of parsed rows.
 *
 * The spec's hash alone treats two genuinely distinct transactions with the
 * same date, amount and description — two $4.50 coffees at the same cafe on
 * the same day — as duplicates, and would silently drop the second one. That
 * is real data loss, not de-duplication.
 *
 * So the stored hash is the spec hash plus an occurrence index, counted
 * against rows that already exist. Re-importing the same statement produces
 * the same indices and every row is correctly detected as a duplicate;
 * importing an overlapping statement that contains one extra repeat produces
 * one new index and imports exactly that one row.
 *
 * `existingCounts` must be keyed by base hash and hold the number of rows
 * already stored for the user, so indices continue rather than restart.
 */
export async function assignDedupeHashes<T>(
  rows: T[],
  toParts: (row: T) => DedupeParts,
  existingCounts: OccurrenceCounts = {},
): Promise<HashedRow<T>[]> {
  const seenInBatch = new Map<string, number>()
  const out: HashedRow<T>[] = []

  for (const row of rows) {
    const baseHash = await dedupeBaseHash(toParts(row))
    const alreadyStored = existingCounts[baseHash] ?? 0
    const seen = seenInBatch.get(baseHash) ?? 0
    const occurrence = seen
    seenInBatch.set(baseHash, seen + 1)

    out.push({
      row,
      baseHash,
      dedupeHash: `${baseHash}:${occurrence}`,
      occurrence,
      // Duplicate when a row with this base hash and occurrence index is
      // already stored.
      isDuplicate: occurrence < alreadyStored,
    })
  }

  return out
}

/** Count stored rows per base hash, given the full `dedupe_hash` values. */
export function countExistingByBaseHash(storedHashes: string[]): OccurrenceCounts {
  const counts: OccurrenceCounts = {}
  for (const hash of storedHashes) {
    const base = hash.includes(':') ? hash.slice(0, hash.indexOf(':')) : hash
    counts[base] = (counts[base] ?? 0) + 1
  }
  return counts
}
