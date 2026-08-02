import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART } from './chartTheme'
import { Button, cx } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'
import { formatMoney, formatMoneyShort } from '../lib/money'
import { addMonths, formatDate, formatDateShort, todayISO, type ISODate } from '../lib/dates'
import type { NetWorthSnapshot } from '../types'

export type TrendRange = '3M' | '6M' | '1Y' | 'All'

const RANGES: TrendRange[] = ['3M', '6M', '1Y', 'All']

export interface TrendPoint {
  as_at: ISODate
  netWorth: number
}

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

/**
 * The primary chart. A single series, so it carries no legend — the heading
 * names it — and it reads from the materialised net_worth_snapshots table
 * rather than recomputing across history on every render.
 */
export function NetWorthTrend({
  snapshots,
  baseCurrency,
  range,
  onRangeChange,
}: {
  snapshots: NetWorthSnapshot[]
  baseCurrency: string
  range: TrendRange
  onRangeChange: (range: TrendRange) => void
}) {
  const [showTable, setShowTable] = useState(false)

  const points = useMemo<TrendPoint[]>(() => {
    const start = rangeStart(range)
    return snapshots
      .filter((snapshot) => (start ? snapshot.as_at >= start : true))
      .map((snapshot) => ({ as_at: snapshot.as_at, netWorth: Number(snapshot.net_worth_base) }))
  }, [snapshots, range])

  const controls = (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart date range">
      {RANGES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={range === option}
          onClick={() => onRangeChange(option)}
          className={cx(
            'rounded-md px-2 py-1 text-xs font-medium transition-colors',
            range === option
              ? 'bg-brand/15 text-brand'
              : 'text-content-faint hover:bg-surface-hover hover:text-content',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )

  if (points.length === 0) {
    return (
      <div>
        <div className="flex justify-end px-4 pt-3">{controls}</div>
        <EmptyState
          title="No net worth history yet"
          description={
            snapshots.length === 0
              ? 'Record balances for your accounts and the trend line starts building from there.'
              : 'No data points fall inside this range. Try a longer one.'
          }
        />
      </div>
    )
  }

  const values = points.map((point) => point.netWorth)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // Pad the domain so the line does not touch the frame, and always include
  // zero when the series straddles it.
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.02, 1)
  const domain: [number, number] = [min < 0 ? min - pad : Math.max(0, min - pad), max + pad]

  const first = points[0]!
  const last = points[points.length - 1]!
  const rising = last.netWorth >= first.netWorth

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <p className="text-xs text-content-faint">
          {formatDate(first.as_at)} — {formatDate(last.as_at)}
        </p>
        {controls}
      </div>

      <div className="h-64 w-full px-1 pt-3 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.netWorth} stopOpacity={0.32} />
                <stop offset="100%" stopColor={CHART.netWorth} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />

            <XAxis
              dataKey="as_at"
              tickFormatter={(value: string) => formatDateShort(value)}
              stroke={CHART.axis}
              tick={{ fill: CHART.text, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: CHART.grid }}
              minTickGap={28}
            />
            <YAxis
              domain={domain}
              tickFormatter={(value: number) => formatMoneyShort(value, baseCurrency)}
              stroke={CHART.axis}
              tick={{ fill: CHART.text, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={62}
            />

            {min < 0 && <ReferenceLine y={0} stroke={CHART.axis} strokeDasharray="2 2" />}

            <Tooltip
              cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const point = payload[0]?.payload as TrendPoint | undefined
                if (!point) return null
                return (
                  <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg">
                    <p className="text-xs text-content-muted">{formatDate(point.as_at)}</p>
                    <p className="tabular mt-0.5 text-sm font-semibold text-content">
                      {formatMoney(point.netWorth, baseCurrency)}
                    </p>
                  </div>
                )
              }}
            />

            <Area
              type="monotone"
              dataKey="netWorth"
              name="Net worth"
              // Anchor the fill to the bottom of the domain. The default
              // baseline is zero, which sits outside the domain whenever net
              // worth is entirely negative — and the fill then renders above
              // the line instead of below it.
              baseValue={domain[0]}
              stroke={rising ? CHART.netWorth : CHART.negative}
              strokeWidth={2}
              fill="url(#netWorthFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.surface }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-line px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showTable}
          onClick={() => setShowTable((current) => !current)}
        >
          {showTable ? 'Hide' : 'Show'} data table
        </Button>

        {showTable && (
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Net worth by date</caption>
              <thead className="sticky top-0 bg-surface-raised">
                <tr className="text-left text-xs text-content-faint">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Net worth
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {[...points].reverse().map((point) => (
                  <tr key={point.as_at}>
                    <td className="py-1.5 pr-3 text-content-muted">{formatDate(point.as_at)}</td>
                    <td className="tabular py-1.5 text-right text-content">
                      {formatMoney(point.netWorth, baseCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
