import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART } from './chartTheme'
import { EmptyState } from '../ui/feedback'
import { formatMoney, formatMoneyShort } from '../lib/money'
import { formatMonth } from '../lib/dates'
import type { CategorySpend, MonthTotals } from '../lib/spending'

/**
 * Spending by category.
 *
 * A ranked bar chart, not a pie: comparing lengths against a shared baseline
 * is the thing people can actually do accurately, and there are usually more
 * than five categories. One measure, so one colour — the category is named on
 * the axis, and colour would only repeat information.
 */
export function CategorySpendChart({
  data,
  labelFor,
  baseCurrency,
  max = 10,
}: {
  data: CategorySpend[]
  labelFor: (categoryId: string | null) => string
  baseCurrency: string
  max?: number
}) {
  if (data.length === 0) {
    return <EmptyState title="No spending in this period" />
  }

  const rows = data.slice(0, max).map((entry) => ({
    label: labelFor(entry.categoryId),
    total: entry.total.toNumber(),
    count: entry.count,
    uncategorised: entry.categoryId === null,
  }))

  return (
    <div className="w-full px-1 pt-3" style={{ height: Math.max(200, rows.length * 34 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(value: number) => formatMoneyShort(value, baseCurrency)}
            stroke={CHART.axis}
            tick={{ fill: CHART.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            stroke={CHART.axis}
            tick={{ fill: CHART.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={120}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0]?.payload as (typeof rows)[number] | undefined
              if (!row) return null
              return (
                <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg">
                  <p className="text-xs text-content-muted">{row.label}</p>
                  <p className="tabular mt-0.5 text-sm font-semibold text-content">
                    {formatMoney(row.total, baseCurrency)}
                  </p>
                  <p className="text-xs text-content-faint">
                    {row.count} transaction{row.count === 1 ? '' : 's'}
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="total" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              // Uncategorised is a gap in the data, not a spending category —
              // the muted fill says so without a second legend.
              <Cell key={row.label} fill={row.uncategorised ? CHART.axis : CHART.netWorth} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Month-over-month spend and income.
 * Two series, so a legend is present and the bars are grouped, not stacked —
 * the comparison is between them, not their sum.
 */
export function MonthComparisonChart({
  months,
  baseCurrency,
}: {
  months: MonthTotals[]
  baseCurrency: string
}) {
  if (months.length === 0) {
    return <EmptyState title="Nothing to compare yet" description="Import or add transactions to see this." />
  }

  const rows = months.map((month) => ({
    month: month.monthStart,
    spend: month.spend.toNumber(),
    income: month.income.toNumber(),
  }))

  const series = [
    { key: 'income', label: 'Income', colour: CHART.positive },
    { key: 'spend', label: 'Spending', colour: CHART.netWorth },
  ]

  return (
    <div>
      <div className="h-56 w-full px-1 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barGap={2}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={(value: string) => formatMonth(value)}
              stroke={CHART.axis}
              tick={{ fill: CHART.text, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: CHART.grid }}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(value: number) => formatMoneyShort(value, baseCurrency)}
              stroke={CHART.axis}
              tick={{ fill: CHART.text, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={62}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-lg">
                    <p className="mb-1 text-xs text-content-muted">{formatMonth(String(label))}</p>
                    <ul className="space-y-0.5">
                      {payload.map((entry) => (
                        <li key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
                          <span
                            aria-hidden="true"
                            className="size-2 rounded-sm"
                            style={{ background: entry.color }}
                          />
                          <span className="flex-1 text-content-muted">{entry.name}</span>
                          <span className="tabular font-medium text-content">
                            {formatMoney(Number(entry.value), baseCurrency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              }}
            />
            {series.map((entry) => (
              <Bar
                key={entry.key}
                dataKey={entry.key}
                name={entry.label}
                fill={entry.colour}
                radius={[4, 4, 0, 0]}
                // Without a cap, a single month renders as one enormous bar.
                maxBarSize={48}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pb-3 pt-2">
        {series.map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5 text-xs text-content-muted">
            <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: entry.colour }} />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
