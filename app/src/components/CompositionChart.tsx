import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART, LIABILITY_COLOUR, assignAssetSeries } from './chartTheme'
import { EmptyState } from '../ui/feedback'
import { Button } from '../ui/primitives'
import { formatMoney, formatMoneyShort } from '../lib/money'
import { formatDate, formatDateShort, type ISODate } from '../lib/dates'
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../types'
import type { NetWorthEngine } from '../lib/networth'

/**
 * Assets by type against liabilities, over time.
 *
 * Liabilities are plotted below the zero line rather than on a second y-axis.
 * One axis, signed — two scales would make the halves silently incomparable.
 */

const LIABILITY_KEY = 'liabilities'
const OTHER_KEY = 'other_assets'

interface Series {
  key: string
  label: string
  colour: string
  stack: 'assets' | 'liabilities'
}

export function CompositionChart({
  engine,
  dates,
  baseCurrency,
}: {
  engine: NetWorthEngine
  dates: ISODate[]
  baseCurrency: string
}) {
  const [showTable, setShowTable] = useState(false)

  const { points, series } = useMemo(() => {
    const typesPresent = new Set<AccountType>()
    for (const valuation of engine.valueAccounts(dates[dates.length - 1] ?? '9999-12-31')) {
      if (valuation.account.class === 'asset' && valuation.account.include_in_net_worth) {
        typesPresent.add(valuation.account.type)
      }
    }

    const { named, folded, otherColour } = assignAssetSeries(typesPresent)
    const namedTypes = new Set(named.map((entry) => entry.type))

    let anyLiability = false
    let anyFolded = false

    const rows = dates.map((date) => {
      const result = engine.computeAt(date)
      const point: Record<string, string | number> = { as_at: date }

      for (const valuation of result.accounts) {
        if (!valuation.account.include_in_net_worth || !valuation.hasData) continue
        const value = valuation.balanceBase.toNumber()

        if (valuation.account.class === 'liability') {
          anyLiability = true
          // Negative, so debt reads below the zero line.
          point[LIABILITY_KEY] = ((point[LIABILITY_KEY] as number) ?? 0) - value
          continue
        }

        const type = valuation.account.type
        const key = namedTypes.has(type) ? `asset_${type}` : OTHER_KEY
        if (key === OTHER_KEY) anyFolded = true
        point[key] = ((point[key] as number) ?? 0) + value
      }
      return point
    })

    const built: Series[] = named.map((entry) => ({
      key: `asset_${entry.type}`,
      label: ACCOUNT_TYPE_LABELS[entry.type],
      colour: entry.colour,
      stack: 'assets',
    }))

    if (anyFolded || folded.length > 0) {
      built.push({
        key: OTHER_KEY,
        label:
          folded.length > 0
            ? `Other assets (${folded.map((type) => ACCOUNT_TYPE_LABELS[type]).join(', ')})`
            : 'Other assets',
        colour: otherColour,
        stack: 'assets',
      })
    }

    if (anyLiability) {
      built.push({ key: LIABILITY_KEY, label: 'Liabilities', colour: LIABILITY_COLOUR, stack: 'liabilities' })
    }

    return { points: rows, series: built }
  }, [engine, dates])

  if (points.length === 0 || series.length === 0) {
    return (
      <EmptyState
        title="Nothing to break down yet"
        description="Once accounts have recorded balances, this shows what your net worth is actually made of."
      />
    )
  }

  // Explicit domain: the default leaves a large empty band under a signed stack.
  let stackedMax = 0
  let stackedMin = 0
  for (const point of points) {
    let positive = 0
    let negative = 0
    for (const entry of series) {
      const value = Number(point[entry.key] ?? 0)
      if (value >= 0) positive += value
      else negative += value
    }
    stackedMax = Math.max(stackedMax, positive)
    stackedMin = Math.min(stackedMin, negative)
  }
  const pad = Math.max((stackedMax - stackedMin) * 0.08, 1)
  const domain: [number, number] = [stackedMin === 0 ? 0 : stackedMin - pad, stackedMax + pad]

  return (
    <div>
      <div className="h-64 w-full px-1 pt-3 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 16, bottom: 4, left: 4 }} stackOffset="sign">
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

            {stackedMin < 0 && <ReferenceLine y={0} stroke={CHART.axis} />}

            <Tooltip
              cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg">
                    <p className="mb-1 text-xs text-content-muted">{formatDate(String(label))}</p>
                    <ul className="space-y-0.5">
                      {payload
                        .filter((entry) => Number(entry.value) !== 0)
                        .map((entry) => (
                          <li key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
                            <span
                              aria-hidden="true"
                              className="size-2 shrink-0 rounded-sm"
                              style={{ background: entry.color }}
                            />
                            <span className="flex-1 text-content-muted">{entry.name}</span>
                            <span className="tabular font-medium text-content">
                              {formatMoney(Math.abs(Number(entry.value)), baseCurrency)}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )
              }}
            />

            {series.map((entry) => (
              <Area
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                name={entry.label}
                stackId={entry.stack}
                fill={entry.colour}
                fillOpacity={0.85}
                // 2px surface-coloured edge separates adjacent stacked fills.
                stroke={CHART.surface}
                strokeWidth={CHART.segmentGap}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Identity is never carried by colour alone. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pt-2">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-xs text-content-muted">
            <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: entry.colour }} />
            {entry.label}
            {entry.stack === 'liabilities' && <span className="text-content-faint">(owed)</span>}
          </li>
        ))}
      </ul>

      <div className="mt-1 border-t border-line px-4 py-2">
        <Button size="sm" variant="ghost" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide' : 'Show'} data table
        </Button>

        {showTable && (
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Net worth composition by date</caption>
              <thead className="sticky top-0 bg-surface-raised">
                <tr className="text-left text-xs text-content-faint">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Date
                  </th>
                  {series.map((entry) => (
                    <th key={entry.key} scope="col" className="py-1.5 pr-3 text-right font-medium">
                      {entry.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {[...points].reverse().map((point) => (
                  <tr key={String(point.as_at)}>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-content-muted">
                      {formatDate(String(point.as_at))}
                    </td>
                    {series.map((entry) => (
                      <td key={entry.key} className="tabular py-1.5 pr-3 text-right text-content">
                        {formatMoney(Math.abs(Number(point[entry.key] ?? 0)), baseCurrency)}
                      </td>
                    ))}
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
