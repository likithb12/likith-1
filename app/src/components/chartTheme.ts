import type { AccountType } from '../types'

/**
 * Chart colour assignments.
 *
 * Why only four categorical hues
 * ------------------------------
 * A stacked area normally only needs its *adjacent* pairs to be
 * colourblind-separable. That guarantee does not hold here: which account
 * types a user owns is unpredictable, so any two types can end up touching
 * once the types between them are absent. The palette therefore has to clear
 * the all-pairs standard, and the largest subset of the categorical palette
 * that does so on this app's surface is four:
 *
 *   node scripts/validate_palette.js "#3987e5,#c98500,#d55181,#008300" \
 *     --mode dark --surface "#131c31" --pairs all   → ALL CHECKS PASS
 *
 * Its worst all-pairs CVD separation sits in the 6–8 band, which is only legal
 * alongside secondary encoding — the chart ships a legend, 2px surface gaps
 * between segments, and a data table.
 *
 * Assets are therefore stacked as at most three types plus "Other assets", and
 * liabilities are a single series, which is what §4.1 asks for anyway: "assets
 * by type vs liabilities".
 */
export const ASSET_SERIES_COLOURS = ['#3987e5', '#c98500', '#d55181', '#008300'] as const

/**
 * Liabilities are not a category alongside the asset types — they are the
 * opposing quantity, drawn below the zero line. A neutral keeps them from
 * reading as "just another type", and position plus the legend label carries
 * the identity. 4.87:1 against the surface.
 */
export const LIABILITY_COLOUR = '#7c8aa5'

/**
 * Fixed order in which asset types claim a colour slot. Colour follows the
 * entity, not its value: the assignment depends only on which types exist, so
 * changing the date range never repaints the series.
 */
export const ASSET_TYPE_ORDER: AccountType[] = ['cash', 'savings', 'offset', 'super', 'brokerage', 'other']

/** How many asset types get their own colour before the rest fold into "Other". */
export const MAX_ASSET_SERIES = 3

export const CHART = {
  surface: '#131c31',
  grid: '#243149',
  axis: '#6b7a99',
  text: '#94a3c0',
  netWorth: '#3987e5',
  positive: '#34d399',
  negative: '#fb7185',
  /** 2px surface-coloured separator between stacked fills. */
  segmentGap: 2,
} as const

/**
 * Decide which asset types get their own series, given the types present.
 * Returns the colour for each, and the list that folds into "Other assets".
 */
export function assignAssetSeries(typesPresent: Iterable<AccountType>): {
  named: { type: AccountType; colour: string }[]
  folded: AccountType[]
  otherColour: string
} {
  const present = new Set(typesPresent)
  const ordered = ASSET_TYPE_ORDER.filter((type) => present.has(type))
  const named = ordered
    .slice(0, MAX_ASSET_SERIES)
    .map((type, index) => ({ type, colour: ASSET_SERIES_COLOURS[index]! }))

  return {
    named,
    folded: ordered.slice(MAX_ASSET_SERIES),
    otherColour: ASSET_SERIES_COLOURS[MAX_ASSET_SERIES]!,
  }
}
