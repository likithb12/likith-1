import { useMemo, useState } from 'react'
import { AmountInput, Button, Card, CardHeader, Field, Input, cx } from '../../ui/primitives'
import { EmptyState, SkeletonRows } from '../../ui/feedback'
import { useToast } from '../../ui/toast'
import { categoryLabel } from './CategorySelect'
import { useCategories } from '../../data/categories'
import { useBudgets, useCopyBudgets, useDeleteBudget, useSaveBudget } from '../../data/budgets'
import { useTransactions } from '../../data/transactions'
import { useBaseCurrency } from '../../data/profile'
import { CategorySpendChart, MonthComparisonChart } from '../../components/SpendingChart'
import { budgetProgress, monthlyTotals, rollUpToParents, spendByCategory } from '../../lib/spending'
import { formatMoney, parseMoneyInput } from '../../lib/money'
import { addMonths, formatMonth, monthEnd, monthStart, todayISO } from '../../lib/dates'
import { describeError } from '../../lib/supabase'

export function BudgetManager() {
  const [month, setMonth] = useState(monthStart(todayISO()))
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const categories = useCategories()
  const budgets = useBudgets()
  const baseCurrency = useBaseCurrency()
  const saveBudget = useSaveBudget()
  const deleteBudget = useDeleteBudget()
  const copyBudgets = useCopyBudgets()
  const { notify } = useToast()

  // A year of history, so the month-over-month chart has something to show.
  const transactions = useTransactions({
    from: monthStart(addMonths(month, -11)),
    to: monthEnd(month),
  })

  const allCategories = categories.data ?? []
  const expenseParents = useMemo(
    () => allCategories.filter((category) => category.kind === 'expense' && category.parent_id === null),
    [allCategories],
  )

  const rows = transactions.data ?? []

  const progress = useMemo(
    () => budgetProgress(budgets.data ?? [], rows, allCategories, month),
    [budgets.data, rows, allCategories, month],
  )
  const progressByCategory = useMemo(
    () => new Map(progress.map((entry) => [entry.categoryId, entry])),
    [progress],
  )

  const monthSpend = useMemo(
    () => rollUpToParents(spendByCategory(rows, { from: month, to: monthEnd(month) }), allCategories),
    [rows, month, allCategories],
  )

  const months = useMemo(() => monthlyTotals(rows), [rows])

  const budgetedTotal = progress.reduce((sum, entry) => sum + entry.budget.toNumber(), 0)
  const spentTotal = monthSpend.reduce((sum, entry) => sum + entry.total.toNumber(), 0)

  async function commit(categoryId: string, raw: string) {
    const trimmed = raw.trim()
    try {
      if (trimmed === '') {
        await deleteBudget.mutateAsync({ categoryId, periodMonth: month })
        return
      }
      const parsed = parseMoneyInput(trimmed)
      if (!parsed || parsed.isNegative()) {
        notify('That budget amount could not be read.', { tone: 'error' })
        return
      }
      await saveBudget.mutateAsync({
        categoryId,
        periodMonth: month,
        amount: parsed,
        currency: baseCurrency,
      })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    } finally {
      setDrafts((current) => {
        const { [categoryId]: _removed, ...rest } = current
        return rest
      })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 p-4">
          <Field label="Month" className="w-44">
            {(props) => (
              <Input
                {...props}
                type="month"
                value={month.slice(0, 7)}
                onChange={(event) => setMonth(`${event.target.value}-01`)}
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={copyBudgets.isPending}
              onClick={async () => {
                try {
                  const copied = await copyBudgets.mutateAsync({
                    fromMonth: addMonths(month, -1),
                    toMonth: month,
                  })
                  notify(
                    copied > 0
                      ? `Copied ${copied} budgets from ${formatMonth(addMonths(month, -1))}.`
                      : `No budgets set for ${formatMonth(addMonths(month, -1))}.`,
                    { tone: copied > 0 ? 'success' : 'error' },
                  )
                } catch (error) {
                  notify(describeError(error), { tone: 'error' })
                }
              }}
            >
              Copy from last month
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-line p-4 sm:grid-cols-3">
          <Summary label="Budgeted" value={formatMoney(budgetedTotal, baseCurrency)} />
          <Summary label="Spent" value={formatMoney(spentTotal, baseCurrency)} />
          <Summary
            label="Remaining"
            value={formatMoney(budgetedTotal - spentTotal, baseCurrency)}
            tone={budgetedTotal - spentTotal < 0 ? 'negative' : 'positive'}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Budgets for ${formatMonth(month)}`}
          subtitle="Set an amount per category. Spending on subcategories counts toward the parent."
        />

        {categories.isLoading ? (
          <SkeletonRows rows={5} />
        ) : expenseParents.length === 0 ? (
          <EmptyState
            title="No expense categories yet"
            description="Create some in the Categories tab, then set budgets here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {expenseParents.map((category) => {
              const entry = progressByCategory.get(category.id)
              const spent = monthSpend.find((row) => row.categoryId === category.id)?.total.toNumber() ?? 0
              const draft = drafts[category.id]
              const value = draft ?? (entry ? entry.budget.toFixed(2) : '')

              return (
                <li key={category.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-content">{category.name}</span>
                    <span className="tabular text-xs text-content-muted">
                      {formatMoney(spent, baseCurrency)} spent
                    </span>
                    <div className="w-32">
                      <label htmlFor={`budget-${category.id}`} className="sr-only">
                        Monthly budget for {category.name}
                      </label>
                      <AmountInput
                        id={`budget-${category.id}`}
                        value={value}
                        placeholder="No budget"
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [category.id]: event.target.value }))
                        }
                        onBlur={(event) => {
                          if (draft !== undefined) void commit(category.id, event.target.value)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        }}
                      />
                    </div>
                  </div>

                  {entry && (
                    <div className="mt-2">
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
                        role="progressbar"
                        aria-valuenow={Math.round(entry.percent)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${category.name} budget used`}
                      >
                        <div
                          className={cx(
                            'h-full rounded-full transition-all',
                            entry.isOver ? 'bg-negative' : entry.percent > 80 ? 'bg-caution' : 'bg-positive',
                          )}
                          style={{ width: `${Math.min(100, entry.percent)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-content-faint">
                        {Math.round(entry.percent)}% used ·{' '}
                        {entry.isOver
                          ? `${formatMoney(entry.remaining.abs(), baseCurrency)} over`
                          : `${formatMoney(entry.remaining, baseCurrency)} left`}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`Spending by category — ${formatMonth(month)}`} />
        <CategorySpendChart
          data={monthSpend}
          baseCurrency={baseCurrency}
          labelFor={(categoryId) => categoryLabel(allCategories, categoryId)}
        />
      </Card>

      <Card>
        <CardHeader title="Month over month" subtitle="Transfers excluded from both series." />
        <MonthComparisonChart months={months} baseCurrency={baseCurrency} />
      </Card>
    </div>
  )
}

function Summary({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative'
}) {
  const tones = { neutral: 'text-content', positive: 'text-content', negative: 'text-negative' }
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <p className="text-xs text-content-muted">{label}</p>
      <p className={cx('tabular mt-0.5 text-base font-semibold', tones[tone])}>{value}</p>
    </div>
  )
}
