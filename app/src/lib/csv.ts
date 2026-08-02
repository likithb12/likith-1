import type { ISODate } from './dates'

/**
 * CSV parsing for bank statement imports.
 *
 * Written by hand rather than pulled from a library: the requirement is one
 * RFC 4180 parser and a date reader, and a dependency here would be larger
 * than the code it replaces. It handles quoted fields, embedded delimiters and
 * newlines, escaped quotes, CRLF, and a UTF-8 BOM — which is what actually
 * turns up in exports from Australian banks.
 */

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  /** Rows whose column count did not match the header. */
  ragged: number
}

export interface ParseOptions {
  delimiter?: string
  /** Rows to discard before the header row. */
  skipRows?: number
  /** When false, the first retained row is data and headers become col1, col2… */
  hasHeader?: boolean
}

const BOM = '﻿'

/** Guess the delimiter by which candidate yields the most consistent columns. */
export function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t', '|']
  const sample = text.slice(0, 8000)
  let best = ','
  let bestScore = -1

  for (const delimiter of candidates) {
    const rows = parseCsv(sample, { delimiter, hasHeader: false }).rows.slice(0, 10)
    if (rows.length === 0) continue
    const counts = rows.map((row) => row.length)
    const max = Math.max(...counts)
    if (max < 2) continue
    // Prefer many columns, penalise rows that disagree about how many.
    const consistent = counts.filter((count) => count === max).length
    const score = max * consistent
    if (score > bestScore) {
      bestScore = score
      best = delimiter
    }
  }
  return best
}

export function parseCsv(text: string, options: ParseOptions = {}): ParsedCsv {
  const delimiter = options.delimiter || ','
  const skipRows = options.skipRows ?? 0
  const hasHeader = options.hasHeader ?? true

  let input = text
  if (input.startsWith(BOM)) input = input.slice(1)

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let sawAnyChar = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
      sawAnyChar = true
      continue
    }

    if (char === delimiter) {
      record.push(field)
      field = ''
      sawAnyChar = true
      continue
    }

    if (char === '\r') {
      // Swallow CR; the LF that follows ends the record.
      if (input[i + 1] === '\n') continue
      record.push(field)
      records.push(record)
      record = []
      field = ''
      sawAnyChar = false
      continue
    }

    if (char === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      sawAnyChar = false
      continue
    }

    field += char
    sawAnyChar = true
  }

  // Trailing record without a newline.
  if (field !== '' || record.length > 0 || sawAnyChar) {
    record.push(field)
    records.push(record)
  }

  // Skip first, then drop blanks. The user counts `skipRows` against the file
  // as they see it in a text editor, so discarding blank lines beforehand
  // would make "skip 2" eat a different two rows than they intended.
  const afterSkip = records.slice(skipRows).filter((row) => row.some((cell) => cell.trim() !== ''))

  if (afterSkip.length === 0) return { headers: [], rows: [], ragged: 0 }

  let headers: string[]
  let dataRows: string[][]

  if (hasHeader) {
    headers = (afterSkip[0] ?? []).map((cell, index) => cell.trim() || `column_${index + 1}`)
    dataRows = afterSkip.slice(1)
  } else {
    const width = Math.max(...afterSkip.map((row) => row.length))
    headers = Array.from({ length: width }, (_, index) => `column_${index + 1}`)
    dataRows = afterSkip
  }

  const ragged = dataRows.filter((row) => row.length !== headers.length).length

  return { headers, rows: dataRows, ragged }
}

/** Row as a keyed object, tolerating short rows. */
export function toRecord(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((header, index) => {
    out[header] = (row[index] ?? '').trim()
  })
  return out
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

export const DATE_FORMATS = [
  'DD/MM/YYYY',
  'DD/MM/YY',
  'MM/DD/YYYY',
  'YYYY-MM-DD',
  'DD-MM-YYYY',
  'DD-MMM-YYYY',
  'DD-MMM-YY',
  'DD MMM YYYY',
] as const

export type DateFormat = (typeof DATE_FORMATS)[number] | string

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Two-digit years: 70–99 are 1900s, 00–69 are 2000s. */
function expandYear(year: number): number {
  if (year >= 100) return year
  return year >= 70 ? 1900 + year : 2000 + year
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
  )
}

/**
 * Read a date using the profile's declared format.
 *
 * Australian exports are overwhelmingly day-first, and a silent misread of
 * 03/04 as 4 March instead of 3 April is exactly the kind of wrongness that
 * never gets noticed, so the format is explicit rather than sniffed.
 */
export function parseDateWithFormat(
  value: string,
  format: DateFormat,
  /**
   * When true, do not fall back to reading ISO dates. Format *detection* needs
   * this: with the fallback on, every candidate format "reads" an ISO column,
   * so whichever was tried first would win regardless of fit.
   */
  strict = false,
): ISODate | null {
  const raw = (value ?? '').trim()
  if (!raw) return null

  const tokens = String(format).toUpperCase()
  const parts = raw.split(/[^0-9a-zA-Z]+/).filter(Boolean)
  const order = tokens.split(/[^A-Z]+/).filter(Boolean)

  if (parts.length >= 3 && order.length >= 3) {
    let day: number | null = null
    let month: number | null = null
    let year: number | null = null

    order.slice(0, 3).forEach((token, index) => {
      const part = parts[index]!
      if (token.startsWith('D')) day = Number(part)
      else if (token === 'MMM' || token === 'MMMM') month = MONTHS[part.slice(0, 4).toLowerCase()] ?? MONTHS[part.slice(0, 3).toLowerCase()] ?? null
      else if (token.startsWith('M')) month = Number(part)
      else if (token.startsWith('Y')) year = expandYear(Number(part))
    })

    if (day !== null && month !== null && year !== null && isValidDate(year, month, day)) {
      return `${year}-${pad(month)}-${pad(day)}`
    }
  }

  // ISO is unambiguous, so accept it whatever the declared format says.
  if (strict) return null
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, y, m, d] = iso
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    if (isValidDate(year, month, day)) return `${y}-${m}-${d}`
  }

  return null
}

/** Best-guess format for a column of sample values, for the mapping preview. */
export function guessDateFormat(samples: string[]): DateFormat {
  const candidates = DATE_FORMATS
  let best: DateFormat = 'DD/MM/YYYY'
  let bestHits = -1

  for (const format of candidates) {
    const hits = samples.filter((sample) => parseDateWithFormat(sample, format, true) !== null).length
    if (hits > bestHits) {
      bestHits = hits
      best = format
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Read an amount from a statement cell.
 *
 * Returns a signed decimal string, or null if unreadable. Handles currency
 * symbols, thousands separators, trailing CR/DR markers and accounting
 * parentheses.
 */
export function parseCsvAmount(value: string): { amount: string; negative: boolean } | null {
  let raw = (value ?? '').trim()
  if (!raw) return null

  let negative = false

  if (/^\(.*\)$/.test(raw)) {
    negative = true
    raw = raw.slice(1, -1)
  }

  // "120.00 DR" / "120.00 CR" appear in several Australian exports.
  const marker = raw.match(/\b(DR|CR)\b\s*$/i)
  if (marker) {
    if (marker[1]!.toUpperCase() === 'DR') negative = true
    raw = raw.slice(0, marker.index).trim()
  }

  if (raw.startsWith('-')) {
    negative = !negative
    raw = raw.slice(1)
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1)
  }

  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (cleaned === '' || cleaned === '.') return null
  if (!/^\d*\.?\d*$/.test(cleaned)) return null

  const numeric = Number(cleaned)
  if (!Number.isFinite(numeric)) return null

  return { amount: cleaned, negative }
}
