/**
 * Date helpers for financial events.
 *
 * Financial dates are plain calendar dates ("2026-08-02"), never instants.
 * All arithmetic here is done on UTC midnight and formatted back to an ISO
 * date string, so it can never drift a day across a timezone or DST boundary.
 * Display is Australia/Melbourne, per the non-functional requirements.
 */

export type ISODate = string // YYYY-MM-DD

export const DISPLAY_TIMEZONE = 'Australia/Melbourne'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/** Today's calendar date in Melbourne, not in the browser's timezone. */
export function todayISO(now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts // en-CA formats as YYYY-MM-DD
}

function toUTC(date: ISODate): Date {
  return new Date(`${date}T00:00:00Z`)
}

function fromUTC(date: Date): ISODate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: ISODate, days: number): ISODate {
  const dt = toUTC(date)
  dt.setUTCDate(dt.getUTCDate() + days)
  return fromUTC(dt)
}

export function addMonths(date: ISODate, months: number): ISODate {
  const dt = toUTC(date)
  const day = dt.getUTCDate()
  dt.setUTCDate(1)
  dt.setUTCMonth(dt.getUTCMonth() + months)
  // Clamp to the last day of the target month: 31 Jan + 1 month is 28/29 Feb,
  // not 2/3 March.
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  dt.setUTCDate(Math.min(day, lastDay))
  return fromUTC(dt)
}

export function addYears(date: ISODate, years: number): ISODate {
  return addMonths(date, years * 12)
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000)
}

export function monthStart(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`
}

export function monthEnd(date: ISODate): ISODate {
  return addDays(addMonths(monthStart(date), 1), -1)
}

/** "2026-08" — the key used for grouping by month. */
export function monthKey(date: ISODate): string {
  return date.slice(0, 7)
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b
}

/** Inclusive list of month-start dates from `from` to `to`. */
export function monthRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  let cursor = monthStart(from)
  const last = monthStart(to)
  while (cursor <= last) {
    out.push(cursor)
    cursor = addMonths(cursor, 1)
  }
  return out
}

/** Inclusive list of every date from `from` to `to`. Guarded against runaway ranges. */
export function dateRange(from: ISODate, to: ISODate, maxDays = 4000): ISODate[] {
  const out: ISODate[] = []
  let cursor = from
  let guard = 0
  while (cursor <= to && guard < maxDays) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
    guard++
  }
  return out
}

export function formatDate(date: ISODate | null | undefined): string {
  if (!date || !isISODate(date)) return '—'
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(toUTC(date))
}

export function formatDateShort(date: ISODate | null | undefined): string {
  if (!date || !isISODate(date)) return '—'
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
  }).format(toUTC(date))
}

export function formatMonth(date: ISODate | null | undefined): string {
  if (!date || !isISODate(date)) return '—'
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  }).format(toUTC(date))
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: DISPLAY_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(dt)
}

/** "today", "3 days ago", "in 5 days" — for freshness and due-date labels. */
export function relativeDays(date: ISODate, reference: ISODate = todayISO()): string {
  const delta = daysBetween(reference, date)
  if (delta === 0) return 'today'
  if (delta === 1) return 'tomorrow'
  if (delta === -1) return 'yesterday'
  if (delta < 0) {
    const n = Math.abs(delta)
    if (n < 30) return `${n} days ago`
    if (n < 365) return `${Math.round(n / 30)} months ago`
    return `${(n / 365).toFixed(1)} years ago`
  }
  if (delta < 30) return `in ${delta} days`
  if (delta < 365) return `in ${Math.round(delta / 30)} months`
  return `in ${(delta / 365).toFixed(1)} years`
}

export type Recurrence = 'none' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'

/** Next occurrence for a recurrence rule, or null for one-off items. */
export function nextOccurrence(date: ISODate, recurrence: Recurrence): ISODate | null {
  switch (recurrence) {
    case 'weekly':
      return addDays(date, 7)
    case 'fortnightly':
      return addDays(date, 14)
    case 'monthly':
      return addMonths(date, 1)
    case 'quarterly':
      return addMonths(date, 3)
    case 'annual':
      return addYears(date, 1)
    case 'none':
    default:
      return null
  }
}

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual' | 'irregular'

/** Expected occurrences per year, used to annualise income. */
export function frequencyPerYear(frequency: Frequency): number | null {
  switch (frequency) {
    case 'weekly':
      return 52
    case 'fortnightly':
      return 26
    case 'monthly':
      return 12
    case 'quarterly':
      return 4
    case 'annual':
      return 1
    case 'irregular':
    default:
      return null
  }
}
