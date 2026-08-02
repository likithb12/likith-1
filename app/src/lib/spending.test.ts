import { describe, expect, it } from 'vitest'
import {
  budgetProgress,
  combinedIncome,
  monthSummary,
  monthlySavings,
  monthlyTotals,
  periodSummary,
  rollUpToParents,
  savingsRate,
  spendByCategory,
  trailingTwelveMonths,
} from './spending'
import { Decimal } from './money'
import type { Budget, Category, IncomeEvent, Transaction } from '../types'

const USER = 'user-1'

function txn(overrides: Partial<Transaction> & { id: string; txn_date: string; amount: string }): Transaction {
  return {
    user_id: USER,
    account_id: 'acct-1',
    direction: 'debit',
    currency: 'AUD',
    description_raw: null,
    description: null,
    category_id: null,
    is_transfer: false,
    transfer_pair_id: null,
    source: 'manual',
    import_batch_id: null,
    dedupe_hash: overrides.id,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function category(id: string, parentId: string | null = null): Category {
  return {
    id,
    user_id: USER,
    name: id,
    parent_id: parentId,
    kind: 'expense',
    colour: null,
    created_at: '2026-01-01T00:00:00Z',
  }
}

function budget(categoryId: string, amount: string, month = '2026-06-01'): Budget {
  return {
    id: `b-${categoryId}`,
    user_id: USER,
    category_id: categoryId,
    period_month: month,
    amount,
    currency: 'AUD',
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('transfers are not spending', () => {
  const transactions = [
    txn({ id: '1', txn_date: '2026-06-05', amount: '100.00' }),
    txn({ id: '2', txn_date: '2026-06-06', amount: '5000.00', is_transfer: true }),
    txn({ id: '3', txn_date: '2026-06-07', amount: '5000.00', direction: 'credit', is_transfer: true }),
  ]

  it('excludes transfers from monthly spend and income', () => {
    const [june] = monthlyTotals(transactions)
    expect(june?.spend.toFixed(2)).toBe('100.00')
    expect(june?.income.toFixed(2)).toBe('0.00')
  })

  it('excludes transfers from category spend', () => {
    const total = spendByCategory(transactions).reduce((sum, entry) => sum.plus(entry.total), new Decimal(0))
    expect(total.toFixed(2)).toBe('100.00')
  })

  it('excludes transfers from the month summary', () => {
    const summary = monthSummary(transactions, [], '2026-06-15')
    expect(summary.spend.toFixed(2)).toBe('100.00')
    expect(summary.income.toFixed(2)).toBe('0.00')
  })
})

describe('monthlyTotals', () => {
  const transactions = [
    txn({ id: '1', txn_date: '2026-05-31', amount: '10.00' }),
    txn({ id: '2', txn_date: '2026-06-01', amount: '20.00' }),
    txn({ id: '3', txn_date: '2026-06-30', amount: '30.00' }),
    txn({ id: '4', txn_date: '2026-06-15', amount: '1000.00', direction: 'credit' }),
  ]

  it('buckets by calendar month, ascending', () => {
    const totals = monthlyTotals(transactions)
    expect(totals.map((t) => t.month)).toEqual(['2026-05', '2026-06'])
    expect(totals[1]?.spend.toFixed(2)).toBe('50.00')
    expect(totals[1]?.income.toFixed(2)).toBe('1000.00')
    expect(totals[1]?.net.toFixed(2)).toBe('950.00')
  })

  it('respects a date window', () => {
    const totals = monthlyTotals(transactions, { from: '2026-06-01', to: '2026-06-30' })
    expect(totals).toHaveLength(1)
  })

  it('respects an account filter', () => {
    const mixed = [
      txn({ id: '1', txn_date: '2026-06-01', amount: '10.00', account_id: 'a' }),
      txn({ id: '2', txn_date: '2026-06-02', amount: '20.00', account_id: 'b' }),
    ]
    expect(monthlyTotals(mixed, { accountId: 'a' })[0]?.spend.toFixed(2)).toBe('10.00')
  })

  it('does not drift on repeated cents', () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      txn({ id: `t${i}`, txn_date: '2026-06-01', amount: '0.10' }),
    )
    expect(monthlyTotals(many)[0]?.spend.toFixed(2)).toBe('0.30')
  })
})

describe('spendByCategory', () => {
  const transactions = [
    txn({ id: '1', txn_date: '2026-06-01', amount: '50.00', category_id: 'food' }),
    txn({ id: '2', txn_date: '2026-06-02', amount: '25.00', category_id: 'food' }),
    txn({ id: '3', txn_date: '2026-06-03', amount: '90.00', category_id: 'rent' }),
    txn({ id: '4', txn_date: '2026-06-04', amount: '5.00' }),
    txn({ id: '5', txn_date: '2026-06-05', amount: '999.00', direction: 'credit', category_id: 'food' }),
  ]

  it('sums debits per category, largest first', () => {
    const spend = spendByCategory(transactions)
    expect(spend.map((entry) => entry.categoryId)).toEqual(['rent', 'food', null])
    expect(spend[1]?.total.toFixed(2)).toBe('75.00')
    expect(spend[1]?.count).toBe(2)
  })

  it('keeps uncategorised spend under a null id rather than dropping it', () => {
    const uncategorised = spendByCategory(transactions).find((entry) => entry.categoryId === null)
    expect(uncategorised?.total.toFixed(2)).toBe('5.00')
  })

  it('ignores credits', () => {
    const food = spendByCategory(transactions).find((entry) => entry.categoryId === 'food')
    expect(food?.total.toFixed(2)).toBe('75.00')
  })
})

describe('rollUpToParents', () => {
  const categories = [category('transport'), category('fuel', 'transport'), category('rent')]

  it('folds child spend into the parent', () => {
    const spend = [
      { categoryId: 'fuel', total: new Decimal('60.00'), count: 2 },
      { categoryId: 'transport', total: new Decimal('40.00'), count: 1 },
      { categoryId: 'rent', total: new Decimal('500.00'), count: 1 },
    ]
    const rolled = rollUpToParents(spend, categories)
    expect(rolled.find((entry) => entry.categoryId === 'transport')?.total.toFixed(2)).toBe('100.00')
    expect(rolled.find((entry) => entry.categoryId === 'fuel')).toBeUndefined()
  })

  it('leaves uncategorised alone', () => {
    const rolled = rollUpToParents([{ categoryId: null, total: new Decimal('5'), count: 1 }], categories)
    expect(rolled[0]?.categoryId).toBeNull()
  })
})

describe('budgetProgress', () => {
  const categories = [category('food'), category('transport'), category('fuel', 'transport')]

  it('compares spend against the budget for that month only', () => {
    const transactions = [
      txn({ id: '1', txn_date: '2026-06-10', amount: '80.00', category_id: 'food' }),
      txn({ id: '2', txn_date: '2026-05-10', amount: '500.00', category_id: 'food' }),
      txn({ id: '3', txn_date: '2026-07-01', amount: '500.00', category_id: 'food' }),
    ]
    const progress = budgetProgress([budget('food', '100.00')], transactions, categories, '2026-06-15')

    expect(progress[0]?.spent.toFixed(2)).toBe('80.00')
    expect(progress[0]?.remaining.toFixed(2)).toBe('20.00')
    expect(progress[0]?.percent).toBeCloseTo(80)
    expect(progress[0]?.isOver).toBe(false)
  })

  it('counts child-category spend against a parent budget', () => {
    const transactions = [txn({ id: '1', txn_date: '2026-06-10', amount: '60.00', category_id: 'fuel' })]
    const progress = budgetProgress([budget('transport', '100.00')], transactions, categories, '2026-06-01')
    expect(progress[0]?.spent.toFixed(2)).toBe('60.00')
  })

  it('reports overspend beyond 100 per cent rather than capping', () => {
    const transactions = [txn({ id: '1', txn_date: '2026-06-10', amount: '150.00', category_id: 'food' })]
    const progress = budgetProgress([budget('food', '100.00')], transactions, categories, '2026-06-01')
    expect(progress[0]?.isOver).toBe(true)
    expect(progress[0]?.percent).toBeCloseTo(150)
    expect(progress[0]?.remaining.toFixed(2)).toBe('-50.00')
  })

  it('excludes transfers from budget spend', () => {
    const transactions = [
      txn({ id: '1', txn_date: '2026-06-10', amount: '80.00', category_id: 'food' }),
      txn({ id: '2', txn_date: '2026-06-11', amount: '900.00', category_id: 'food', is_transfer: true }),
    ]
    const progress = budgetProgress([budget('food', '100.00')], transactions, categories, '2026-06-01')
    expect(progress[0]?.spent.toFixed(2)).toBe('80.00')
  })

  it('returns nothing when no budget is set for the month', () => {
    expect(budgetProgress([budget('food', '100.00', '2026-05-01')], [], categories, '2026-06-01')).toEqual([])
  })
})

describe('savingsRate', () => {
  it('is (income − spend) / income', () => {
    expect(savingsRate(new Decimal('5000'), new Decimal('4000'))?.toFixed(1)).toBe('20.0')
  })

  it('goes negative when spending exceeds income', () => {
    expect(savingsRate(new Decimal('1000'), new Decimal('1500'))?.toFixed(1)).toBe('-50.0')
  })

  it('is null when there was no income', () => {
    expect(savingsRate(new Decimal(0), new Decimal('100'))).toBeNull()
  })
})

describe('combinedIncome', () => {
  const transactions = [
    txn({ id: '1', txn_date: '2026-06-15', amount: '5000.00', direction: 'credit' }),
    txn({ id: '2', txn_date: '2026-06-20', amount: '200.00', direction: 'credit', is_transfer: true }),
  ]

  function event(overrides: Partial<IncomeEvent> & { id: string; received_on: string; net_amount: string }): IncomeEvent {
    return {
      user_id: USER,
      income_source_id: null,
      gross_amount: null,
      currency: 'AUD',
      account_id: null,
      transaction_id: null,
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  it('counts credit transactions', () => {
    const result = combinedIncome(transactions, [], '2026-06-01', '2026-06-30')
    expect(result.total.toFixed(2)).toBe('5000.00')
    expect(result.fromTransactions.toFixed(2)).toBe('5000.00')
  })

  it('adds income events that are not matched to a transaction', () => {
    const events = [event({ id: 'e1', received_on: '2026-06-10', net_amount: '750.00' })]
    const result = combinedIncome(transactions, events, '2026-06-01', '2026-06-30')
    expect(result.fromEvents.toFixed(2)).toBe('750.00')
    expect(result.total.toFixed(2)).toBe('5750.00')
  })

  it('does NOT double count an event matched to a transaction', () => {
    // The event and the transaction describe the same money.
    const events = [event({ id: 'e1', received_on: '2026-06-15', net_amount: '5000.00', transaction_id: '1' })]
    const result = combinedIncome(transactions, events, '2026-06-01', '2026-06-30')
    expect(result.fromEvents.toFixed(2)).toBe('0.00')
    expect(result.total.toFixed(2)).toBe('5000.00')
  })

  it('ignores transfers and events outside the window', () => {
    const events = [event({ id: 'e1', received_on: '2026-05-31', net_amount: '999.00' })]
    expect(combinedIncome(transactions, events, '2026-06-01', '2026-06-30').total.toFixed(2)).toBe('5000.00')
  })
})

describe('periodSummary and trailing twelve months', () => {
  const transactions = [
    txn({ id: 'i1', txn_date: '2026-06-15', amount: '5000.00', direction: 'credit' }),
    txn({ id: 'e1', txn_date: '2026-06-16', amount: '4000.00' }),
    txn({ id: 'old', txn_date: '2025-01-01', amount: '10000.00' }),
  ]

  it('computes a savings rate for a period', () => {
    const summary = periodSummary(transactions, [], '2026-06-01', '2026-06-30')
    expect(summary.income.toFixed(2)).toBe('5000.00')
    expect(summary.spend.toFixed(2)).toBe('4000.00')
    expect(summary.net.toFixed(2)).toBe('1000.00')
    expect(summary.rate?.toFixed(1)).toBe('20.0')
  })

  it('covers exactly twelve months back to the start of that month', () => {
    const summary = trailingTwelveMonths(transactions, [], '2026-08-02')
    // Sep 2025 through Aug 2026 — the Jan 2025 row is outside the window.
    expect(summary.from).toBe('2025-09-01')
    expect(summary.spend.toFixed(2)).toBe('4000.00')
  })

  it('reports a null rate when there was no income', () => {
    const summary = periodSummary([txn({ id: 'e1', txn_date: '2026-06-16', amount: '10.00' })], [], '2026-06-01', '2026-06-30')
    expect(summary.rate).toBeNull()
  })

  it('gives one summary per requested month', () => {
    const summaries = monthlySavings(transactions, [], ['2026-05-01', '2026-06-01'])
    expect(summaries).toHaveLength(2)
    expect(summaries[0]?.income.toFixed(2)).toBe('0.00')
    expect(summaries[1]?.rate?.toFixed(1)).toBe('20.0')
  })
})
