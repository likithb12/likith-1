import { Decimal, d } from './money'
import { addMonths, monthKey, monthStart, type ISODate } from './dates'
import type { Budget, Category, IncomeEvent, Transaction } from '../types'

/**
 * Spending and income aggregation.
 *
 * One rule governs everything here: **transfers between your own accounts are
 * not spending.** Moving $5,000 from savings to an offset account is not a
 * $5,000 expense, and counting it would make every total meaningless. Any
 * transaction flagged `is_transfer` is excluded from both spend and income.
 */

export interface SpendOptions {
  /** Ignore transactions outside this window. */
  from?: ISODate | null
  to?: ISODate | null
  accountId?: string | null
}

function inScope(transaction: Transaction, options: SpendOptions): boolean {
  if (transaction.is_transfer) return false
  if (options.from && transaction.txn_date < options.from) return false
  if (options.to && transaction.txn_date > options.to) return false
  if (options.accountId && transaction.account_id !== options.accountId) return false
  return true
}

export function isExpense(transaction: Transaction): boolean {
  return transaction.direction === 'debit' && !transaction.is_transfer
}

export function isIncome(transaction: Transaction): boolean {
  return transaction.direction === 'credit' && !transaction.is_transfer
}

export interface MonthTotals {
  month: string
  monthStart: ISODate
  spend: Decimal
  income: Decimal
  net: Decimal
}

/** Totals per calendar month, ascending. */
export function monthlyTotals(transactions: Transaction[], options: SpendOptions = {}): MonthTotals[] {
  const buckets = new Map<string, { spend: Decimal; income: Decimal }>()

  for (const transaction of transactions) {
    if (!inScope(transaction, options)) continue
    const key = monthKey(transaction.txn_date)
    const bucket = buckets.get(key) ?? { spend: new Decimal(0), income: new Decimal(0) }
    if (transaction.direction === 'debit') bucket.spend = bucket.spend.plus(d(transaction.amount))
    else bucket.income = bucket.income.plus(d(transaction.amount))
    buckets.set(key, bucket)
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, bucket]) => ({
      month,
      monthStart: `${month}-01`,
      spend: bucket.spend,
      income: bucket.income,
      net: bucket.income.minus(bucket.spend),
    }))
}

export interface CategorySpend {
  categoryId: string | null
  total: Decimal
  count: number
}

/** Spend per category. Uncategorised rows are grouped under a null id. */
export function spendByCategory(transactions: Transaction[], options: SpendOptions = {}): CategorySpend[] {
  const buckets = new Map<string | null, { total: Decimal; count: number }>()

  for (const transaction of transactions) {
    if (!inScope(transaction, options)) continue
    if (transaction.direction !== 'debit') continue

    const key = transaction.category_id
    const bucket = buckets.get(key) ?? { total: new Decimal(0), count: 0 }
    bucket.total = bucket.total.plus(d(transaction.amount))
    bucket.count++
    buckets.set(key, bucket)
  }

  return [...buckets.entries()]
    .map(([categoryId, bucket]) => ({ categoryId, total: bucket.total, count: bucket.count }))
    .sort((a, b) => b.total.comparedTo(a.total))
}

/**
 * Roll child categories up into their parent, so a parent's budget covers
 * spending recorded against its subcategories.
 */
export function rollUpToParents(
  spend: CategorySpend[],
  categories: Category[],
): CategorySpend[] {
  const parentOf = new Map(categories.map((category) => [category.id, category.parent_id]))
  const buckets = new Map<string | null, { total: Decimal; count: number }>()

  for (const entry of spend) {
    const key = entry.categoryId ? (parentOf.get(entry.categoryId) ?? entry.categoryId) : null
    const bucket = buckets.get(key) ?? { total: new Decimal(0), count: 0 }
    bucket.total = bucket.total.plus(entry.total)
    bucket.count += entry.count
    buckets.set(key, bucket)
  }

  return [...buckets.entries()]
    .map(([categoryId, bucket]) => ({ categoryId, total: bucket.total, count: bucket.count }))
    .sort((a, b) => b.total.comparedTo(a.total))
}

export interface BudgetProgress {
  categoryId: string
  budget: Decimal
  spent: Decimal
  remaining: Decimal
  /** 0–100+ — deliberately uncapped so overspend is visible. */
  percent: number
  isOver: boolean
}

/**
 * Budget vs actual for one month.
 *
 * Spending is rolled up to parent categories first, so a budget on "Transport"
 * covers whatever landed on "Fuel".
 */
export function budgetProgress(
  budgets: Budget[],
  transactions: Transaction[],
  categories: Category[],
  month: ISODate,
): BudgetProgress[] {
  const period = monthStart(month)
  const monthly = budgets.filter((budget) => budget.period_month === period)
  if (monthly.length === 0) return []

  const spend = rollUpToParents(
    spendByCategory(transactions, { from: period, to: lastDayOf(period) }),
    categories,
  )
  const spentByCategory = new Map(spend.map((entry) => [entry.categoryId, entry.total]))

  return monthly
    .map((budget) => {
      const amount = d(budget.amount)
      const spent = spentByCategory.get(budget.category_id) ?? new Decimal(0)
      return {
        categoryId: budget.category_id,
        budget: amount,
        spent,
        remaining: amount.minus(spent),
        percent: amount.isZero() ? (spent.isZero() ? 0 : 100) : spent.div(amount).times(100).toNumber(),
        isOver: spent.gt(amount),
      }
    })
    .sort((a, b) => b.percent - a.percent)
}

function lastDayOf(period: ISODate): ISODate {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period.slice(0, 7)}-${String(last).padStart(2, '0')}`
}

/** Totals for a single month, for the dashboard's "this month" panel. */
export function monthSummary(
  transactions: Transaction[],
  budgets: Budget[],
  month: ISODate,
): { spend: Decimal; income: Decimal; budgeted: Decimal; hasBudget: boolean } {
  const period = monthStart(month)
  const to = lastDayOf(period)

  let spend = new Decimal(0)
  let income = new Decimal(0)

  for (const transaction of transactions) {
    if (!inScope(transaction, { from: period, to })) continue
    if (transaction.direction === 'debit') spend = spend.plus(d(transaction.amount))
    else income = income.plus(d(transaction.amount))
  }

  const monthlyBudgets = budgets.filter((budget) => budget.period_month === period)
  const budgeted = monthlyBudgets.reduce((sum, budget) => sum.plus(d(budget.amount)), new Decimal(0))

  return { spend, income, budgeted, hasBudget: monthlyBudgets.length > 0 }
}

/**
 * Savings rate: (income − expenses) / income.
 * Null when there was no income — dividing by zero is not a rate.
 */
export function savingsRate(income: Decimal, spend: Decimal): Decimal | null {
  if (income.lte(0)) return null
  return income.minus(spend).div(income).times(100)
}

/**
 * Total income for a period, from both sources, without double counting.
 *
 * Income arrives two ways: as a credit transaction (usually imported), and as
 * a manually recorded income event. An event that is matched to a transaction
 * describes the *same* money, so counting both would inflate income and
 * flatter the savings rate. Matched events are therefore skipped, and only
 * unmatched ones are added.
 */
export function combinedIncome(
  transactions: Transaction[],
  incomeEvents: IncomeEvent[],
  from: ISODate,
  to: ISODate,
): { total: Decimal; fromTransactions: Decimal; fromEvents: Decimal } {
  let fromTransactions = new Decimal(0)
  for (const transaction of transactions) {
    if (!inScope(transaction, { from, to })) continue
    if (transaction.direction !== 'credit') continue
    fromTransactions = fromTransactions.plus(d(transaction.amount))
  }

  let fromEvents = new Decimal(0)
  for (const event of incomeEvents) {
    if (event.transaction_id) continue
    if (event.received_on < from || event.received_on > to) continue
    fromEvents = fromEvents.plus(d(event.net_amount))
  }

  return { total: fromTransactions.plus(fromEvents), fromTransactions, fromEvents }
}

export interface PeriodSummary {
  from: ISODate
  to: ISODate
  income: Decimal
  spend: Decimal
  net: Decimal
  rate: Decimal | null
}

export function periodSummary(
  transactions: Transaction[],
  incomeEvents: IncomeEvent[],
  from: ISODate,
  to: ISODate,
): PeriodSummary {
  let spend = new Decimal(0)
  for (const transaction of transactions) {
    if (!inScope(transaction, { from, to })) continue
    if (transaction.direction === 'debit') spend = spend.plus(d(transaction.amount))
  }

  const income = combinedIncome(transactions, incomeEvents, from, to).total

  return { from, to, income, spend, net: income.minus(spend), rate: savingsRate(income, spend) }
}

/** Per-month income, spend and savings rate, ascending. */
export function monthlySavings(
  transactions: Transaction[],
  incomeEvents: IncomeEvent[],
  months: ISODate[],
): PeriodSummary[] {
  return months.map((month) => {
    const start = monthStart(month)
    return periodSummary(transactions, incomeEvents, start, lastDayOf(start))
  })
}

/** Trailing twelve months ending on `asAt`, inclusive. */
export function trailingTwelveMonths(
  transactions: Transaction[],
  incomeEvents: IncomeEvent[],
  asAt: ISODate,
): PeriodSummary {
  const start = monthStart(addMonths(asAt, -11))
  return periodSummary(transactions, incomeEvents, start, asAt)
}
