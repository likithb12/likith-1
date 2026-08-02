import { Decimal, d } from './money'
import { FxTable, convert } from './fx'
import { daysBetween, type ISODate } from './dates'
import { STALE_AFTER_DAYS, type Account, type BalanceSnapshot, type Holding, type Obligation, type PricePoint } from '../types'

/**
 * Net worth calculation. This is priority 1 of the product, so it is a pure
 * function over plain data with no I/O, and it is the single source of truth
 * for the number — the dashboard, the materialised `net_worth_snapshots`
 * table and the JSON export all go through here.
 *
 * Sign conventions
 * ----------------
 * Liability account balances are stored as POSITIVE magnitudes meaning
 * "amount owed". Net worth = assets − liabilities. A credit card in credit is
 * entered as a negative liability balance and correctly reduces the total.
 *
 * Double-counting guard
 * ---------------------
 * An obligation carrying a `linked_account_id` that points at an account
 * included in net worth is DISPLAY-ONLY: the account balance is authoritative.
 * Counting both would double the debt. Unlinked obligations do count —
 * payables as liabilities, receivables as assets.
 */

export interface NetWorthOptions {
  baseCurrency: string
  accounts: Account[]
  balanceSnapshots: BalanceSnapshot[]
  holdings?: Holding[]
  pricePoints?: PricePoint[]
  obligations?: Obligation[]
  fx?: FxTable
  staleAfterDays?: number
}

export interface AccountValuation {
  account: Account
  /** Balance in the account's own currency. */
  balanceNative: Decimal
  /** Balance converted to the base currency. */
  balanceBase: Decimal
  currency: string
  /** Date of the snapshot actually used, or null when there is no data yet. */
  asAtUsed: ISODate | null
  /** Age of that snapshot in days relative to the valuation date. */
  ageDays: number | null
  isStale: boolean
  /** False when the account has no snapshot at or before the valuation date. */
  hasData: boolean
  derivedFromHoldings: boolean
  /** A holding fell back to average cost because no price was available. */
  pricesStale: boolean
  fxStale: boolean
  fxMissing: boolean
}

export type ObligationExclusion = 'linked_to_account' | 'settled' | 'written_off' | 'nothing_outstanding'

export interface ObligationValuation {
  obligation: Obligation
  outstandingNative: Decimal
  outstandingBase: Decimal
  countedInNetWorth: boolean
  excludedReason: ObligationExclusion | null
  fxStale: boolean
  fxMissing: boolean
}

export interface NetWorthResult {
  asAt: ISODate
  baseCurrency: string
  totalAssetsBase: Decimal
  totalLiabilitiesBase: Decimal
  netWorthBase: Decimal
  /** Split of the totals, so the UI can show what came from where. */
  accountAssetsBase: Decimal
  accountLiabilitiesBase: Decimal
  obligationAssetsBase: Decimal
  obligationLiabilitiesBase: Decimal
  accounts: AccountValuation[]
  obligations: ObligationValuation[]
  staleAccounts: AccountValuation[]
  /** True when at least one account had a snapshot at or before the date. */
  hasAnyData: boolean
  /** Non-blocking honesty: missing FX rates, stale prices, old balances. */
  warnings: string[]
}

interface PriceSeries {
  as_at: ISODate
  price: Decimal
  currency: string
}

/**
 * Pre-indexed inputs. Building this once and valuing many dates against it
 * keeps the trend chart linear rather than quadratic.
 */
export class NetWorthEngine {
  readonly baseCurrency: string
  readonly fx: FxTable
  readonly staleAfterDays: number
  private readonly accounts: Account[]
  private readonly snapshotsByAccount = new Map<string, BalanceSnapshot[]>()
  private readonly holdingsByAccount = new Map<string, Holding[]>()
  private readonly pricesByTicker = new Map<string, PriceSeries[]>()
  private readonly obligations: Obligation[]
  private readonly accountsById = new Map<string, Account>()

  constructor(options: NetWorthOptions) {
    this.baseCurrency = (options.baseCurrency || 'AUD').toUpperCase()
    this.fx = options.fx ?? new FxTable([])
    this.staleAfterDays = options.staleAfterDays ?? STALE_AFTER_DAYS
    this.accounts = options.accounts ?? []
    this.obligations = options.obligations ?? []

    for (const account of this.accounts) {
      this.accountsById.set(account.id, account)
    }

    for (const snapshot of options.balanceSnapshots ?? []) {
      const list = this.snapshotsByAccount.get(snapshot.account_id)
      if (list) list.push(snapshot)
      else this.snapshotsByAccount.set(snapshot.account_id, [snapshot])
    }
    for (const list of this.snapshotsByAccount.values()) {
      list.sort((a, b) => (a.as_at < b.as_at ? -1 : a.as_at > b.as_at ? 1 : 0))
    }

    for (const holding of options.holdings ?? []) {
      const list = this.holdingsByAccount.get(holding.account_id)
      if (list) list.push(holding)
      else this.holdingsByAccount.set(holding.account_id, [holding])
    }

    for (const point of options.pricePoints ?? []) {
      const key = tickerKey(point.ticker)
      const entry: PriceSeries = { as_at: point.as_at, price: d(point.price), currency: point.currency }
      const list = this.pricesByTicker.get(key)
      if (list) list.push(entry)
      else this.pricesByTicker.set(key, [entry])
    }
    for (const list of this.pricesByTicker.values()) {
      list.sort((a, b) => (a.as_at < b.as_at ? -1 : a.as_at > b.as_at ? 1 : 0))
    }
  }

  /** Latest balance snapshot for an account at or before a date. */
  private latestSnapshot(accountId: string, asAt: ISODate): BalanceSnapshot | null {
    const list = this.snapshotsByAccount.get(accountId)
    if (!list) return null
    let found: BalanceSnapshot | null = null
    for (const snapshot of list) {
      if (snapshot.as_at <= asAt) found = snapshot
      else break
    }
    return found
  }

  private latestPrice(ticker: string, asAt: ISODate): PriceSeries | null {
    const list = this.pricesByTicker.get(tickerKey(ticker))
    if (!list) return null
    let found: PriceSeries | null = null
    for (const point of list) {
      if (point.as_at <= asAt) found = point
      else break
    }
    return found
  }

  /**
   * Value a brokerage account from its holdings:
   * units × latest price at or before the date. Falls back to average cost
   * when no price exists, flagging the result as stale rather than dropping it.
   */
  private valueHoldings(
    account: Account,
    holdings: Holding[],
    asAt: ISODate,
  ): { native: Decimal; base: Decimal; pricesStale: boolean; fxStale: boolean; fxMissing: boolean } {
    let native = new Decimal(0)
    let base = new Decimal(0)
    let pricesStale = false
    let fxStale = false
    let fxMissing = false

    for (const holding of holdings) {
      const units = d(holding.units)
      const price = this.latestPrice(holding.ticker, asAt)

      let unitPrice: Decimal
      let priceCurrency: string
      if (price) {
        unitPrice = price.price
        priceCurrency = price.currency || holding.currency
        if (price.as_at !== asAt) pricesStale = true
      } else if (holding.avg_cost_per_unit !== null && holding.avg_cost_per_unit !== undefined) {
        unitPrice = d(holding.avg_cost_per_unit)
        priceCurrency = holding.currency
        pricesStale = true
      } else {
        pricesStale = true
        continue
      }

      const value = units.times(unitPrice)

      const toNative = convert(value, priceCurrency, account.currency, asAt, this.fx)
      const toBase = convert(value, priceCurrency, this.baseCurrency, asAt, this.fx)
      if (toNative.isStale || toBase.isStale) fxStale = true
      if (toNative.missing || toBase.missing) fxMissing = true

      native = native.plus(toNative.amount)
      base = base.plus(toBase.amount)
    }

    return { native, base, pricesStale, fxStale, fxMissing }
  }

  /** Value every account as at a date, including those with no data yet. */
  valueAccounts(asAt: ISODate): AccountValuation[] {
    return this.accounts.map((account) => {
      const holdings = this.holdingsByAccount.get(account.id) ?? []
      // Holdings are authoritative for a brokerage account that has them;
      // a manual snapshot on such an account would be a second, competing
      // source of truth for the same value.
      const useHoldings = account.type === 'brokerage' && holdings.length > 0

      if (useHoldings) {
        const valued = this.valueHoldings(account, holdings, asAt)
        // Freshness of a derived account is the freshness of its prices.
        const newestPrice = holdings.reduce<ISODate | null>((latest, holding) => {
          const p = this.latestPrice(holding.ticker, asAt)
          if (!p) return latest
          return latest === null || p.as_at > latest ? p.as_at : latest
        }, null)
        const ageDays = newestPrice ? daysBetween(newestPrice, asAt) : null
        return {
          account,
          balanceNative: valued.native,
          balanceBase: valued.base,
          currency: account.currency,
          asAtUsed: newestPrice,
          ageDays,
          isStale: ageDays === null || ageDays > this.staleAfterDays,
          hasData: true,
          derivedFromHoldings: true,
          pricesStale: valued.pricesStale,
          fxStale: valued.fxStale,
          fxMissing: valued.fxMissing,
        }
      }

      const snapshot = this.latestSnapshot(account.id, asAt)
      if (!snapshot) {
        return {
          account,
          balanceNative: new Decimal(0),
          balanceBase: new Decimal(0),
          currency: account.currency,
          asAtUsed: null,
          ageDays: null,
          isStale: false,
          hasData: false,
          derivedFromHoldings: false,
          pricesStale: false,
          fxStale: false,
          fxMissing: false,
        }
      }

      const currency = snapshot.currency || account.currency
      const converted = convert(snapshot.balance, currency, this.baseCurrency, asAt, this.fx)
      const ageDays = daysBetween(snapshot.as_at, asAt)

      return {
        account,
        balanceNative: d(snapshot.balance),
        balanceBase: converted.amount,
        currency,
        asAtUsed: snapshot.as_at,
        ageDays,
        isStale: ageDays > this.staleAfterDays,
        hasData: true,
        derivedFromHoldings: false,
        pricesStale: false,
        fxStale: converted.isStale,
        fxMissing: converted.missing,
      }
    })
  }

  /**
   * Value obligations as at a date, applying the double-counting guard.
   *
   * Note this values the obligation's CURRENT outstanding amount regardless of
   * `asAt`; obligation payments are not historised per date. It is therefore
   * only meaningful for the present. Historical net worth is driven by balance
   * snapshots, which are.
   */
  valueObligations(asAt: ISODate): ObligationValuation[] {
    return this.obligations.map((obligation) => {
      const outstandingNative = Decimal.max(
        d(obligation.amount_total).minus(d(obligation.amount_settled)),
        0,
      )
      const converted = convert(outstandingNative, obligation.currency, this.baseCurrency, asAt, this.fx)

      let excludedReason: ObligationExclusion | null = null
      if (obligation.status === 'written_off') {
        excludedReason = 'written_off'
      } else if (obligation.status === 'settled') {
        excludedReason = 'settled'
      } else if (outstandingNative.lte(0)) {
        excludedReason = 'nothing_outstanding'
      } else if (obligation.linked_account_id) {
        // The guard. Only excludes when the linked account actually
        // contributes to net worth — a link to a deleted or excluded account
        // must not silently erase the obligation from the total.
        const linked = this.accountsById.get(obligation.linked_account_id)
        if (linked && linked.include_in_net_worth) {
          excludedReason = 'linked_to_account'
        }
      }

      return {
        obligation,
        outstandingNative,
        outstandingBase: converted.amount,
        countedInNetWorth: excludedReason === null,
        excludedReason,
        fxStale: converted.isStale,
        fxMissing: converted.missing,
      }
    })
  }

  /** Full valuation as at a date. */
  computeAt(asAt: ISODate): NetWorthResult {
    const accounts = this.valueAccounts(asAt)
    const obligations = this.valueObligations(asAt)

    let accountAssetsBase = new Decimal(0)
    let accountLiabilitiesBase = new Decimal(0)
    let hasAnyData = false
    let anyFxMissing = false
    let anyPricesStale = false

    for (const valuation of accounts) {
      if (valuation.hasData) hasAnyData = true
      if (valuation.fxMissing) anyFxMissing = true
      if (valuation.pricesStale) anyPricesStale = true
      if (!valuation.account.include_in_net_worth || !valuation.hasData) continue
      if (valuation.account.class === 'asset') {
        accountAssetsBase = accountAssetsBase.plus(valuation.balanceBase)
      } else {
        accountLiabilitiesBase = accountLiabilitiesBase.plus(valuation.balanceBase)
      }
    }

    let obligationAssetsBase = new Decimal(0)
    let obligationLiabilitiesBase = new Decimal(0)
    for (const valuation of obligations) {
      if (valuation.fxMissing) anyFxMissing = true
      if (!valuation.countedInNetWorth) continue
      if (valuation.obligation.direction === 'receivable') {
        obligationAssetsBase = obligationAssetsBase.plus(valuation.outstandingBase)
      } else {
        obligationLiabilitiesBase = obligationLiabilitiesBase.plus(valuation.outstandingBase)
      }
    }

    const totalAssetsBase = accountAssetsBase.plus(obligationAssetsBase)
    const totalLiabilitiesBase = accountLiabilitiesBase.plus(obligationLiabilitiesBase)

    const staleAccounts = accounts.filter(
      (a) => a.account.include_in_net_worth && a.hasData && a.isStale,
    )

    const warnings: string[] = []
    if (staleAccounts.length > 0) {
      warnings.push(
        `${staleAccounts.length} account${staleAccounts.length === 1 ? '' : 's'} not updated in over ${this.staleAfterDays} days`,
      )
    }
    if (anyFxMissing) {
      warnings.push('Some amounts could not be converted — no exchange rate available')
    }
    if (anyPricesStale) {
      warnings.push('Some holdings are valued at a stale or fallback price')
    }

    return {
      asAt,
      baseCurrency: this.baseCurrency,
      totalAssetsBase,
      totalLiabilitiesBase,
      netWorthBase: totalAssetsBase.minus(totalLiabilitiesBase),
      accountAssetsBase,
      accountLiabilitiesBase,
      obligationAssetsBase,
      obligationLiabilitiesBase,
      accounts,
      obligations,
      staleAccounts,
      hasAnyData,
      warnings,
    }
  }

  /** Value a list of dates. Used to build the trend series. */
  computeSeries(dates: ISODate[]): NetWorthResult[] {
    return dates.map((date) => this.computeAt(date))
  }

  /**
   * Dates on which any input changed — the only dates where the net worth
   * line can bend. Charting these instead of every calendar day keeps the
   * series small without losing a single movement.
   */
  significantDates(): ISODate[] {
    const dates = new Set<ISODate>()
    for (const list of this.snapshotsByAccount.values()) {
      for (const snapshot of list) dates.add(snapshot.as_at)
    }
    for (const list of this.pricesByTicker.values()) {
      for (const point of list) dates.add(point.as_at)
    }
    return [...dates].sort()
  }
}

/** One-shot convenience wrapper. */
export function computeNetWorthAt(asAt: ISODate, options: NetWorthOptions): NetWorthResult {
  return new NetWorthEngine(options).computeAt(asAt)
}

function tickerKey(ticker: string): string {
  return (ticker ?? '').trim().toUpperCase()
}

/** Grouped asset totals by account type, for the stacked breakdown chart. */
export function groupByType(result: NetWorthResult): {
  assets: { type: string; total: Decimal }[]
  liabilities: { type: string; total: Decimal }[]
} {
  const assets = new Map<string, Decimal>()
  const liabilities = new Map<string, Decimal>()

  for (const valuation of result.accounts) {
    if (!valuation.account.include_in_net_worth || !valuation.hasData) continue
    const target = valuation.account.class === 'asset' ? assets : liabilities
    const key = valuation.account.type
    target.set(key, (target.get(key) ?? new Decimal(0)).plus(valuation.balanceBase))
  }

  return {
    assets: [...assets].map(([type, total]) => ({ type, total })),
    liabilities: [...liabilities].map(([type, total]) => ({ type, total })),
  }
}
