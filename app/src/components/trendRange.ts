import { addMonths, todayISO, type ISODate } from '../lib/dates'

/**
 * Chart range helpers.
 *
 * These live apart from NetWorthTrend so the dashboard can import them without
 * pulling in the charting library — importing anything from that module
 * statically would cancel its lazy loading.
 */

export type TrendRange = '3M' | '6M' | '1Y' | 'All'

export const TREND_RANGES: TrendRange[] = ['3M', '6M', '1Y', 'All']

/** Earliest date included for a range, or null for "All". */
export function rangeStart(range: TrendRange, today: ISODate = todayISO()): ISODate | null {
  switch (range) {
    case '3M':
      return addMonths(today, -3)
    case '6M':
      return addMonths(today, -6)
    case '1Y':
      return addMonths(today, -12)
    case 'All':
    default:
      return null
  }
}
