import Decimal from 'decimal.js'

// Money is never a float. Values cross the wire as strings, are parsed into
// Decimal for arithmetic, and are written back as fixed-scale strings so
// Postgres `numeric` parses them exactly.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 30 })

export type Numeric = string | number | Decimal

/** Scale used for monetary amounts, matching `numeric(18,2)` in the schema. */
export const MONEY_SCALE = 2
/** Scale used for unit counts (`numeric(18,6)`) and prices. */
export const UNIT_SCALE = 6
/** Scale used for FX rates (`numeric(18,8)`). */
export const RATE_SCALE = 8

/**
 * Parse any inbound numeric into a Decimal.
 *
 * Numbers are stringified first: PostgREST serialises `numeric` as a JSON
 * number, and `String(n)` yields JavaScript's shortest round-trip
 * representation, which recovers the intended decimal ("1234.56", not
 * "1234.5600000000000023"). Reading via Decimal(number) directly would
 * capture the binary error instead.
 */
export function d(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  if (value instanceof Decimal) return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return new Decimal(0)
    return new Decimal(String(value))
  }
  const trimmed = value.trim()
  if (trimmed === '') return new Decimal(0)
  try {
    return new Decimal(trimmed)
  } catch {
    return new Decimal(0)
  }
}

export const ZERO = new Decimal(0)

export function sum(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Decimal(0))
}

/** Round to money scale. Half-up, which is what people expect on a statement. */
export function round(value: Numeric, scale = MONEY_SCALE): Decimal {
  return d(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP)
}

/** Serialise for writing to a Postgres `numeric` column. */
export function toDb(value: Numeric, scale = MONEY_SCALE): string {
  return round(value, scale).toFixed(scale)
}

/** Serialise a value that may legitimately be absent. */
export function toDbOrNull(value: Numeric | null | undefined, scale = MONEY_SCALE): string | null {
  if (value === null || value === undefined || value === '') return null
  return toDb(value, scale)
}

export function isZero(value: Numeric): boolean {
  return d(value).isZero()
}

export function isNegative(value: Numeric): boolean {
  return d(value).isNegative()
}

/**
 * Parse a value typed by a human. Accepts thousands separators, a leading
 * currency symbol, and accounting-style negatives like "(1,234.50)".
 * Returns null for anything it cannot read, so callers can show a field error
 * rather than silently recording zero.
 */
export function parseMoneyInput(raw: string): Decimal | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (s === '') return null

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }

  s = s.replace(/[\s,]/g, '').replace(/[^0-9.\-+]/g, '')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (s === '' || s === '.') return null
  if (!/^\d*\.?\d*$/.test(s)) return null

  try {
    const value = new Decimal(s)
    return negative ? value.negated() : value
  } catch {
    return null
  }
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, minimumFractionDigits: number, maximumFractionDigits: number) {
  const key = `${currency}|${minimumFractionDigits}|${maximumFractionDigits}`
  let f = formatterCache.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency,
        minimumFractionDigits,
        maximumFractionDigits,
      })
    } catch {
      f = new Intl.NumberFormat('en-AU', {
        style: 'decimal',
        minimumFractionDigits,
        maximumFractionDigits,
      })
    }
    formatterCache.set(key, f)
  }
  return f
}

export function formatMoney(value: Numeric, currency = 'AUD'): string {
  return formatter(currency, 2, 2).format(round(value).toNumber())
}

/** Compact form for chart axes and tight mobile layouts: $1.2k, $3.4M. */
export function formatMoneyShort(value: Numeric, currency = 'AUD'): string {
  const v = d(value)
  const abs = v.abs()
  const sign = v.isNegative() ? '-' : ''
  const symbol = currencySymbol(currency)
  if (abs.gte(1_000_000)) return `${sign}${symbol}${abs.div(1_000_000).toFixed(abs.gte(10_000_000) ? 0 : 1)}M`
  if (abs.gte(1_000)) return `${sign}${symbol}${abs.div(1_000).toFixed(abs.gte(10_000) ? 0 : 1)}k`
  return `${sign}${symbol}${abs.toFixed(0)}`
}

export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? '$'
  } catch {
    return '$'
  }
}

/** Signed form with an explicit + for gains, used by the change indicators. */
export function formatSigned(value: Numeric, currency = 'AUD'): string {
  const v = round(value)
  const formatted = formatMoney(v.abs(), currency)
  if (v.isZero()) return formatted
  return `${v.isNegative() ? '−' : '+'}${formatted}`
}

/**
 * Percentage change from `from` to `to`.
 * Returns null when the base is zero — an infinite percentage is not a fact
 * worth rendering, and the caller shows the absolute change instead.
 */
export function percentChange(from: Numeric, to: Numeric): Decimal | null {
  const base = d(from)
  if (base.isZero()) return null
  return d(to).minus(base).div(base.abs()).times(100)
}

export function formatPercent(value: Numeric | null, decimals = 1): string {
  if (value === null) return '—'
  const v = d(value)
  const sign = v.isNegative() ? '−' : '+'
  return `${sign}${v.abs().toFixed(decimals)}%`
}

export { Decimal }
