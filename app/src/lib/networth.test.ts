import { describe, expect, it } from 'vitest'
import { NetWorthEngine, computeNetWorthAt, groupByType } from './networth'
import { FxTable } from './fx'
import { account, holding, obligation, price, snapshot } from './__fixtures'

const BASE = 'AUD'

describe('net worth — accounts', () => {
  it('is assets minus liabilities', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [
        account({ id: 'a', class: 'asset', type: 'savings' }),
        account({ id: 'b', class: 'liability', type: 'loan' }),
      ],
      balanceSnapshots: [
        snapshot({ account_id: 'a', as_at: '2026-06-30', balance: '50000.00' }),
        snapshot({ account_id: 'b', as_at: '2026-06-30', balance: '20000.00' }),
      ],
    })

    expect(result.totalAssetsBase.toFixed(2)).toBe('50000.00')
    expect(result.totalLiabilitiesBase.toFixed(2)).toBe('20000.00')
    expect(result.netWorthBase.toFixed(2)).toBe('30000.00')
  })

  it('carries the most recent snapshot at or before the date forward', () => {
    const engine = new NetWorthEngine({
      baseCurrency: BASE,
      accounts: [account({ id: 'a' })],
      balanceSnapshots: [
        snapshot({ account_id: 'a', as_at: '2026-01-31', balance: '100.00' }),
        snapshot({ account_id: 'a', as_at: '2026-03-31', balance: '300.00' }),
      ],
    })

    expect(engine.computeAt('2026-02-15').netWorthBase.toFixed(2)).toBe('100.00')
    expect(engine.computeAt('2026-03-31').netWorthBase.toFixed(2)).toBe('300.00')
    expect(engine.computeAt('2026-12-01').netWorthBase.toFixed(2)).toBe('300.00')
  })

  it('does not count an account before its first snapshot', () => {
    const result = computeNetWorthAt('2026-01-01', {
      baseCurrency: BASE,
      accounts: [account({ id: 'a' })],
      balanceSnapshots: [snapshot({ account_id: 'a', as_at: '2026-06-01', balance: '999.00' })],
    })

    expect(result.netWorthBase.toFixed(2)).toBe('0.00')
    expect(result.hasAnyData).toBe(false)
    expect(result.accounts[0]?.hasData).toBe(false)
  })

  it('excludes accounts flagged out of net worth but still reports them', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [
        account({ id: 'a' }),
        account({ id: 'b', include_in_net_worth: false }),
      ],
      balanceSnapshots: [
        snapshot({ account_id: 'a', as_at: '2026-06-30', balance: '100.00' }),
        snapshot({ account_id: 'b', as_at: '2026-06-30', balance: '500.00' }),
      ],
    })

    expect(result.netWorthBase.toFixed(2)).toBe('100.00')
    expect(result.accounts).toHaveLength(2)
  })

  it('treats a negative liability balance as reducing debt', () => {
    // A credit card in credit.
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [account({ id: 'cc', class: 'liability', type: 'credit_card' })],
      balanceSnapshots: [snapshot({ account_id: 'cc', as_at: '2026-06-30', balance: '-150.00' })],
    })

    expect(result.totalLiabilitiesBase.toFixed(2)).toBe('-150.00')
    expect(result.netWorthBase.toFixed(2)).toBe('150.00')
  })

  it('keeps cent precision across many accounts', () => {
    const accounts = Array.from({ length: 100 }, (_, i) => account({ id: `a${i}` }))
    const snapshots = accounts.map((a) =>
      snapshot({ account_id: a.id, as_at: '2026-06-30', balance: '0.07' }),
    )

    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts,
      balanceSnapshots: snapshots,
    })

    // 0.07 * 100 is 7.000000000000001 in float arithmetic.
    expect(result.netWorthBase.toFixed(2)).toBe('7.00')
  })
})

describe('net worth — staleness', () => {
  it('flags accounts not updated within the threshold', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [account({ id: 'fresh' }), account({ id: 'stale' })],
      balanceSnapshots: [
        snapshot({ account_id: 'fresh', as_at: '2026-06-20', balance: '10.00' }),
        snapshot({ account_id: 'stale', as_at: '2026-01-05', balance: '10.00' }),
      ],
      staleAfterDays: 30,
    })

    expect(result.staleAccounts.map((s) => s.account.id)).toEqual(['stale'])
    expect(result.warnings.some((w) => w.includes('not updated'))).toBe(true)
  })

  it('reports the age of the snapshot used', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [account({ id: 'a' })],
      balanceSnapshots: [snapshot({ account_id: 'a', as_at: '2026-06-25', balance: '10.00' })],
    })

    expect(result.accounts[0]?.ageDays).toBe(5)
    expect(result.accounts[0]?.asAtUsed).toBe('2026-06-25')
  })
})

describe('net worth — obligation double-counting guard', () => {
  const loanAccount = account({ id: 'loan-1', class: 'liability', type: 'loan' })
  const loanSnapshot = snapshot({ account_id: 'loan-1', as_at: '2026-06-30', balance: '20000.00' })
  const assetSnapshot = snapshot({ account_id: 'cash-1', as_at: '2026-06-30', balance: '50000.00' })
  const cashAccount = account({ id: 'cash-1', class: 'asset' })

  it('does NOT count a payable linked to a liability account', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount, loanAccount],
      balanceSnapshots: [assetSnapshot, loanSnapshot],
      obligations: [
        obligation({ id: 'o1', amount_total: '20000.00', linked_account_id: 'loan-1' }),
      ],
    })

    // 50,000 − 20,000. The obligation must not add a second 20,000.
    expect(result.netWorthBase.toFixed(2)).toBe('30000.00')
    expect(result.obligationLiabilitiesBase.toFixed(2)).toBe('0.00')

    const valuation = result.obligations[0]
    expect(valuation?.countedInNetWorth).toBe(false)
    expect(valuation?.excludedReason).toBe('linked_to_account')
    // Still reported, because the obligations screen shows it.
    expect(valuation?.outstandingBase.toFixed(2)).toBe('20000.00')
  })

  it('DOES count an unlinked payable as a liability', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount],
      balanceSnapshots: [assetSnapshot],
      obligations: [obligation({ id: 'o1', counterparty: 'ATO', amount_total: '5000.00' })],
    })

    expect(result.obligationLiabilitiesBase.toFixed(2)).toBe('5000.00')
    expect(result.netWorthBase.toFixed(2)).toBe('45000.00')
    expect(result.obligations[0]?.countedInNetWorth).toBe(true)
  })

  it('counts an unlinked receivable as an asset', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount],
      balanceSnapshots: [assetSnapshot],
      obligations: [
        obligation({ id: 'o1', direction: 'receivable', counterparty: 'Dad', amount_total: '1200.00' }),
      ],
    })

    expect(result.obligationAssetsBase.toFixed(2)).toBe('1200.00')
    expect(result.netWorthBase.toFixed(2)).toBe('51200.00')
  })

  it('counts only the unsettled remainder of a partially paid obligation', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount],
      balanceSnapshots: [assetSnapshot],
      obligations: [
        obligation({
          id: 'o1',
          amount_total: '5000.00',
          amount_settled: '1500.00',
          status: 'partial',
        }),
      ],
    })

    expect(result.obligationLiabilitiesBase.toFixed(2)).toBe('3500.00')
  })

  it('ignores settled and written-off obligations', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount],
      balanceSnapshots: [assetSnapshot],
      obligations: [
        obligation({ id: 'o1', amount_total: '100.00', amount_settled: '100.00', status: 'settled' }),
        obligation({ id: 'o2', amount_total: '900.00', status: 'written_off' }),
      ],
    })

    expect(result.obligationLiabilitiesBase.toFixed(2)).toBe('0.00')
    expect(result.netWorthBase.toFixed(2)).toBe('50000.00')
  })

  it('still counts an obligation linked to an account excluded from net worth', () => {
    // The guard exists to avoid double counting. If the linked account is not
    // in the total, there is nothing to double count and dropping the
    // obligation would understate the debt.
    const excluded = account({
      id: 'loan-x',
      class: 'liability',
      type: 'loan',
      include_in_net_worth: false,
    })

    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount, excluded],
      balanceSnapshots: [
        assetSnapshot,
        snapshot({ account_id: 'loan-x', as_at: '2026-06-30', balance: '7000.00' }),
      ],
      obligations: [obligation({ id: 'o1', amount_total: '7000.00', linked_account_id: 'loan-x' })],
    })

    expect(result.obligationLiabilitiesBase.toFixed(2)).toBe('7000.00')
    expect(result.netWorthBase.toFixed(2)).toBe('43000.00')
  })

  it('still counts an obligation whose linked account no longer exists', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [cashAccount],
      balanceSnapshots: [assetSnapshot],
      obligations: [obligation({ id: 'o1', amount_total: '400.00', linked_account_id: 'deleted' })],
    })

    expect(result.obligationLiabilitiesBase.toFixed(2)).toBe('400.00')
  })
})

describe('net worth — FX', () => {
  const fx = new FxTable([
    { base_currency: 'USD', quote_currency: 'AUD', as_at: '2026-06-30', rate: '1.50' },
  ])

  it('converts foreign accounts into the base currency', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: 'AUD',
      accounts: [account({ id: 'us', currency: 'USD' })],
      balanceSnapshots: [
        snapshot({ account_id: 'us', as_at: '2026-06-30', balance: '1000.00', currency: 'USD' }),
      ],
      fx,
    })

    expect(result.netWorthBase.toFixed(2)).toBe('1500.00')
    expect(result.accounts[0]?.balanceNative.toFixed(2)).toBe('1000.00')
  })

  it('passes the amount through and warns when no rate exists', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: 'AUD',
      accounts: [account({ id: 'jp', currency: 'JPY' })],
      balanceSnapshots: [
        snapshot({ account_id: 'jp', as_at: '2026-06-30', balance: '1000.00', currency: 'JPY' }),
      ],
      fx,
    })

    expect(result.accounts[0]?.fxMissing).toBe(true)
    expect(result.warnings.some((w) => w.includes('exchange rate'))).toBe(true)
  })
})

describe('net worth — holdings', () => {
  it('derives a brokerage balance from units times latest price', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [account({ id: 'brk', type: 'brokerage' })],
      balanceSnapshots: [],
      holdings: [holding({ id: 'h1', account_id: 'brk', ticker: 'VAS.AX', units: '100' })],
      pricePoints: [
        price({ ticker: 'VAS.AX', as_at: '2026-06-01', price: '95.00' }),
        price({ ticker: 'VAS.AX', as_at: '2026-06-28', price: '100.50' }),
      ],
    })

    expect(result.netWorthBase.toFixed(2)).toBe('10050.00')
    expect(result.accounts[0]?.derivedFromHoldings).toBe(true)
  })

  it('falls back to average cost and flags staleness when no price exists', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [account({ id: 'brk', type: 'brokerage' })],
      balanceSnapshots: [],
      holdings: [
        holding({
          id: 'h1',
          account_id: 'brk',
          ticker: 'ABC.AX',
          units: '10',
          avg_cost_per_unit: '12.3456',
        }),
      ],
      pricePoints: [],
    })

    expect(result.netWorthBase.toFixed(2)).toBe('123.46')
    expect(result.accounts[0]?.pricesStale).toBe(true)
    expect(result.warnings.some((w) => w.includes('stale or fallback price'))).toBe(true)
  })

  it('uses fractional units without float drift', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [account({ id: 'brk', type: 'brokerage' })],
      balanceSnapshots: [],
      holdings: [holding({ id: 'h1', account_id: 'brk', ticker: 'X.AX', units: '3.300000' })],
      pricePoints: [price({ ticker: 'X.AX', as_at: '2026-06-30', price: '1.10' })],
    })

    expect(result.netWorthBase.toFixed(2)).toBe('3.63')
  })
})

describe('significantDates and groupByType', () => {
  it('returns only dates where an input changed', () => {
    const engine = new NetWorthEngine({
      baseCurrency: BASE,
      accounts: [account({ id: 'a' })],
      balanceSnapshots: [
        snapshot({ account_id: 'a', as_at: '2026-03-31', balance: '1.00' }),
        snapshot({ account_id: 'a', as_at: '2026-01-31', balance: '2.00' }),
      ],
    })

    expect(engine.significantDates()).toEqual(['2026-01-31', '2026-03-31'])
  })

  it('groups balances by account type', () => {
    const result = computeNetWorthAt('2026-06-30', {
      baseCurrency: BASE,
      accounts: [
        account({ id: 'a', type: 'savings' }),
        account({ id: 'b', type: 'savings' }),
        account({ id: 'c', class: 'liability', type: 'loan' }),
      ],
      balanceSnapshots: [
        snapshot({ account_id: 'a', as_at: '2026-06-30', balance: '10.00' }),
        snapshot({ account_id: 'b', as_at: '2026-06-30', balance: '15.00' }),
        snapshot({ account_id: 'c', as_at: '2026-06-30', balance: '5.00' }),
      ],
    })

    const grouped = groupByType(result)
    expect(grouped.assets).toEqual([{ type: 'savings', total: expect.anything() }])
    expect(grouped.assets[0]?.total.toFixed(2)).toBe('25.00')
    expect(grouped.liabilities[0]?.total.toFixed(2)).toBe('5.00')
  })
})
