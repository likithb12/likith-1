import { Badge } from './primitives'
import { formatDate, relativeDays, type ISODate } from '../lib/dates'
import { STALE_AFTER_DAYS } from '../types'

/**
 * How old is this number?
 *
 * The stale-data problem is the main failure mode of a manual tracker, so
 * every figure derived from a balance carries its age. A confident net worth
 * built on three-month-old inputs is worse than no figure at all.
 */
export function FreshnessBadge({
  asAt,
  ageDays,
  hasData = true,
  staleAfterDays = STALE_AFTER_DAYS,
}: {
  asAt: ISODate | null
  ageDays: number | null
  hasData?: boolean
  staleAfterDays?: number
}) {
  if (!hasData || asAt === null) {
    return (
      <Badge tone="neutral" title="No balance has been recorded for this account yet">
        No data
      </Badge>
    )
  }

  const age = ageDays ?? 0
  const label = relativeDays(asAt)
  const title = `Last updated ${formatDate(asAt)}`

  if (age > staleAfterDays * 3) {
    return (
      <Badge tone="negative" title={title}>
        ⚠ {label}
      </Badge>
    )
  }
  if (age > staleAfterDays) {
    return (
      <Badge tone="caution" title={title}>
        {label}
      </Badge>
    )
  }
  return (
    <Badge tone="neutral" title={title}>
      {label}
    </Badge>
  )
}
