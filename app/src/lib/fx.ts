import { Decimal, d } from './money'
import { daysBetween, type ISODate } from './dates'

/**
 * FX conversion.
 *
 * Rates are cached in `fx_rates` and looked up as-at a date. Per the spec, if
 * no rate exists for a given date we use the most recent prior rate and flag
 * it. Conversion never throws and never silently drops a value: when no rate
 * can be found at all the amount is returned unconverted with `missing: true`
 * so the UI can say so out loud.
 */

export interface FxRateInput {
  base_currency: string
  quote_currency: string
  as_at: ISODate
  rate: string | number
}

export type FxPath = 'identity' | 'direct' | 'inverse' | 'triangulated'

export interface ConversionResult {
  /** Converted amount. Equal to the input amount when `missing` is true. */
  amount: Decimal
  /** Effective from→to multiplier actually applied. */
  rate: Decimal
  path: FxPath
  /** Date of the rate used, or null for identity/missing. */
  rateDate: ISODate | null
  /** True when the rate used is not dated exactly as-at the requested date. */
  isStale: boolean
  /** How far the rate date is from the requested date. Negative = future rate. */
  staleDays: number
  /** True when no usable rate existed and the amount was passed through. */
  missing: boolean
}

interface RatePoint {
  as_at: ISODate
  rate: Decimal
}

/**
 * Indexed rate lookup. Build once per render pass and reuse — the dashboard
 * converts thousands of amounts and a linear scan per conversion is wasteful.
 */
export class FxTable {
  private readonly pairs = new Map<string, RatePoint[]>()
  private readonly currencies = new Set<string>()

  constructor(rates: FxRateInput[] = []) {
    for (const r of rates) {
      const base = normaliseCode(r.base_currency)
      const quote = normaliseCode(r.quote_currency)
      if (!base || !quote || base === quote) continue
      const rate = d(r.rate)
      if (!rate.isFinite() || rate.lte(0)) continue

      this.currencies.add(base)
      this.currencies.add(quote)
      const key = pairKey(base, quote)
      const list = this.pairs.get(key)
      if (list) list.push({ as_at: r.as_at, rate })
      else this.pairs.set(key, [{ as_at: r.as_at, rate }])
    }
    // Ascending by date so lookups can scan for the latest rate at or before
    // the target and fall through to the earliest later rate.
    for (const list of this.pairs.values()) {
      list.sort((a, b) => (a.as_at < b.as_at ? -1 : a.as_at > b.as_at ? 1 : 0))
    }
  }

  get knownCurrencies(): string[] {
    return [...this.currencies]
  }

  private lookupPair(from: string, to: string, asAt: ISODate): RatePoint | null {
    const list = this.pairs.get(pairKey(from, to))
    if (!list || list.length === 0) return null

    let best: RatePoint | null = null
    for (const point of list) {
      if (point.as_at <= asAt) best = point
      else break
    }
    // No prior rate: fall back to the earliest known later rate rather than
    // refusing to convert. Flagged as stale with a negative staleDays so the
    // UI can distinguish "rate is old" from "rate is from the future".
    return best ?? list[0] ?? null
  }

  /** Direct or inverse rate for a pair, without triangulation. */
  private directOrInverse(
    from: string,
    to: string,
    asAt: ISODate,
  ): { rate: Decimal; as_at: ISODate; path: FxPath } | null {
    const direct = this.lookupPair(from, to, asAt)
    const inverse = this.lookupPair(to, from, asAt)

    // Prefer whichever quote is closer to the requested date; ties go to the
    // direct quote since it needs no reciprocal.
    if (direct && inverse) {
      const dDist = Math.abs(daysBetween(direct.as_at, asAt))
      const iDist = Math.abs(daysBetween(inverse.as_at, asAt))
      if (iDist < dDist) {
        return { rate: new Decimal(1).div(inverse.rate), as_at: inverse.as_at, path: 'inverse' }
      }
      return { rate: direct.rate, as_at: direct.as_at, path: 'direct' }
    }
    if (direct) return { rate: direct.rate, as_at: direct.as_at, path: 'direct' }
    if (inverse) return { rate: new Decimal(1).div(inverse.rate), as_at: inverse.as_at, path: 'inverse' }
    return null
  }

  /** Effective multiplier for from→to, trying direct, inverse, then a pivot. */
  resolve(from: string, to: string, asAt: ISODate): { rate: Decimal; as_at: ISODate; path: FxPath } | null {
    const a = normaliseCode(from)
    const b = normaliseCode(to)
    if (!a || !b) return null
    if (a === b) return { rate: new Decimal(1), as_at: asAt, path: 'identity' }

    const straight = this.directOrInverse(a, b, asAt)
    if (straight) return straight

    for (const pivot of this.currencies) {
      if (pivot === a || pivot === b) continue
      const first = this.directOrInverse(a, pivot, asAt)
      if (!first) continue
      const second = this.directOrInverse(pivot, b, asAt)
      if (!second) continue
      return {
        rate: first.rate.times(second.rate),
        // The older of the two legs governs how stale the result is.
        as_at: first.as_at < second.as_at ? first.as_at : second.as_at,
        path: 'triangulated',
      }
    }
    return null
  }
}

function normaliseCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

function pairKey(base: string, quote: string): string {
  return `${base}>${quote}`
}

export function convert(
  amount: string | number | Decimal,
  from: string,
  to: string,
  asAt: ISODate,
  table: FxTable,
): ConversionResult {
  const value = d(amount)
  const a = normaliseCode(from)
  const b = normaliseCode(to)

  if (a === b || !a || !b) {
    return {
      amount: value,
      rate: new Decimal(1),
      path: 'identity',
      rateDate: null,
      isStale: false,
      staleDays: 0,
      missing: false,
    }
  }

  const resolved = table.resolve(a, b, asAt)
  if (!resolved) {
    return {
      amount: value,
      rate: new Decimal(1),
      path: 'identity',
      rateDate: null,
      isStale: true,
      staleDays: 0,
      missing: true,
    }
  }

  const staleDays = daysBetween(resolved.as_at, asAt)
  return {
    amount: value.times(resolved.rate),
    rate: resolved.rate,
    path: resolved.path,
    rateDate: resolved.as_at,
    isStale: resolved.as_at !== asAt,
    staleDays,
    missing: false,
  }
}

/** Convenience for callers that only need the number and will flag staleness elsewhere. */
export function convertAmount(
  amount: string | number | Decimal,
  from: string,
  to: string,
  asAt: ISODate,
  table: FxTable,
): Decimal {
  return convert(amount, from, to, asAt, table).amount
}

export const COMMON_CURRENCIES = [
  'AUD',
  'USD',
  'EUR',
  'GBP',
  'NZD',
  'JPY',
  'SGD',
  'HKD',
  'CAD',
  'CHF',
  'INR',
  'CNY',
] as const
