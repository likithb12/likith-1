import { parseCsv, parseCsvAmount, parseDateWithFormat, toRecord, type ParsedCsv } from './csv'
import type { ISODate } from './dates'
import type { AmountConvention, TxnDirection } from '../types'

/**
 * Turns a parsed CSV plus an import profile into transaction drafts.
 *
 * Rows that cannot be read are reported, never dropped silently — a statement
 * that imports "successfully" while quietly discarding a third of its rows is
 * worse than one that fails.
 */

export interface MappingProfile {
  date_column: string
  date_format: string
  amount_column: string | null
  amount_convention: AmountConvention
  debit_column: string | null
  credit_column: string | null
  description_columns: string[]
  skip_rows: number
  delimiter: string
}

export interface DraftTransaction {
  rowIndex: number
  txn_date: ISODate
  /** Positive magnitude; the sign lives in `direction`. */
  amount: string
  direction: TxnDirection
  description_raw: string
  description: string
}

export interface RowError {
  rowIndex: number
  reason: string
  raw: string[]
}

export interface MappingResult {
  drafts: DraftTransaction[]
  errors: RowError[]
  parsed: ParsedCsv
}

export function parseWithProfile(text: string, profile: MappingProfile): ParsedCsv {
  return parseCsv(text, { delimiter: profile.delimiter, skipRows: profile.skip_rows })
}

export function mapRows(parsed: ParsedCsv, profile: MappingProfile): MappingResult {
  const drafts: DraftTransaction[] = []
  const errors: RowError[] = []

  parsed.rows.forEach((row, rowIndex) => {
    const record = toRecord(parsed.headers, row)

    const rawDate = record[profile.date_column] ?? ''
    const txnDate = parseDateWithFormat(rawDate, profile.date_format)
    if (!txnDate) {
      errors.push({
        rowIndex,
        raw: row,
        reason: rawDate
          ? `Could not read "${rawDate}" as a date in format ${profile.date_format}`
          : `No value in date column "${profile.date_column}"`,
      })
      return
    }

    const money = readAmount(record, profile)
    if (!money) {
      errors.push({ rowIndex, raw: row, reason: 'Could not read an amount from this row' })
      return
    }

    const descriptionRaw = profile.description_columns
      .map((column) => record[column] ?? '')
      .filter((part) => part.trim() !== '')
      .join(' ')
      .trim()

    drafts.push({
      rowIndex,
      txn_date: txnDate,
      amount: money.amount,
      direction: money.direction,
      description_raw: descriptionRaw,
      description: descriptionRaw,
    })
  })

  return { drafts, errors, parsed }
}

function readAmount(
  record: Record<string, string>,
  profile: MappingProfile,
): { amount: string; direction: TxnDirection } | null {
  if (profile.amount_convention === 'separate_debit_credit') {
    const debitRaw = profile.debit_column ? (record[profile.debit_column] ?? '') : ''
    const creditRaw = profile.credit_column ? (record[profile.credit_column] ?? '') : ''

    const debit = parseCsvAmount(debitRaw)
    const credit = parseCsvAmount(creditRaw)

    // A zero in one column alongside a real value in the other is common; the
    // non-zero column wins.
    if (debit && Number(debit.amount) !== 0) return { amount: debit.amount, direction: 'debit' }
    if (credit && Number(credit.amount) !== 0) return { amount: credit.amount, direction: 'credit' }
    return null
  }

  const column = profile.amount_column
  if (!column) return null
  const parsed = parseCsvAmount(record[column] ?? '')
  if (!parsed) return null

  // Money out of the account is negative in a single-column export.
  return { amount: parsed.amount, direction: parsed.negative ? 'debit' : 'credit' }
}

/**
 * Import profiles for the major Australian bank exports, seeded for a new
 * user. These will go stale — the generic mapping UI is the real feature — so
 * they are ordinary editable rows, not hardcoded behaviour.
 */
export interface SeedProfile extends MappingProfile {
  name: string
}

export const AU_BANK_PROFILES: SeedProfile[] = [
  {
    name: 'CBA — Transaction export',
    date_column: 'Date',
    date_format: 'DD/MM/YYYY',
    amount_column: 'Amount',
    amount_convention: 'single_signed',
    debit_column: null,
    credit_column: null,
    description_columns: ['Description'],
    skip_rows: 0,
    delimiter: ',',
  },
  {
    name: 'NAB — Transaction export',
    date_column: 'Date',
    date_format: 'DD-MMM-YY',
    amount_column: 'Amount',
    amount_convention: 'single_signed',
    debit_column: null,
    credit_column: null,
    description_columns: ['Transaction Details', 'Merchant Name'],
    skip_rows: 0,
    delimiter: ',',
  },
  {
    name: 'ANZ — Transaction export',
    date_column: 'Date',
    date_format: 'DD/MM/YYYY',
    amount_column: 'Amount',
    amount_convention: 'single_signed',
    debit_column: null,
    credit_column: null,
    description_columns: ['Description'],
    skip_rows: 0,
    delimiter: ',',
  },
  {
    name: 'Westpac — Transaction export',
    date_column: 'Date',
    date_format: 'DD/MM/YYYY',
    amount_column: null,
    amount_convention: 'separate_debit_credit',
    debit_column: 'Debit Amount',
    credit_column: 'Credit Amount',
    description_columns: ['Narrative'],
    skip_rows: 0,
    delimiter: ',',
  },
  {
    name: 'ING — Transaction export',
    date_column: 'Date',
    date_format: 'DD/MM/YYYY',
    amount_column: null,
    amount_convention: 'separate_debit_credit',
    debit_column: 'Debit',
    credit_column: 'Credit',
    description_columns: ['Description'],
    skip_rows: 0,
    delimiter: ',',
  },
]

/**
 * Suggest a mapping from the headers alone, so a new profile starts mostly
 * filled in rather than blank.
 */
export function suggestMapping(headers: string[]): Partial<MappingProfile> {
  const find = (patterns: RegExp[]) =>
    headers.find((header) => patterns.some((pattern) => pattern.test(header.toLowerCase()))) ?? null

  const dateColumn = find([/^date$/, /date/, /processed/])
  const debitColumn = find([/debit/, /withdrawal/, /money out/])
  const creditColumn = find([/credit/, /deposit/, /money in/])
  const amountColumn = find([/^amount$/, /amount/, /value/])

  const descriptionColumns = headers.filter((header) =>
    /desc|narrative|detail|merchant|reference|payee|particulars/.test(header.toLowerCase()),
  )

  // Two separate columns beat one signed column when both are present.
  const separate = Boolean(debitColumn && creditColumn)

  return {
    date_column: dateColumn ?? headers[0] ?? '',
    amount_column: separate ? null : amountColumn,
    amount_convention: separate ? 'separate_debit_credit' : 'single_signed',
    debit_column: separate ? debitColumn : null,
    credit_column: separate ? creditColumn : null,
    description_columns: descriptionColumns.length > 0 ? descriptionColumns : headers.slice(1, 2),
  }
}
