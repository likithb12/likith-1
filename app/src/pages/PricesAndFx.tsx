import { useMemo, useState } from 'react'
import { AmountInput, Badge, Button, Card, CardHeader, Field, Input, Select } from '../ui/primitives'
import { EmptyState, WarningBanner } from '../ui/feedback'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/toast'
import {
  useDeleteFxRate,
  useDeletePrice,
  useFxRates,
  useHoldings,
  usePricePoints,
  useRefreshFxRates,
  useRefreshPrices,
  useSaveFxRate,
  useSavePrice,
} from '../data/investments'
import { useAccounts } from '../data/accounts'
import { useBaseCurrency, useProfile } from '../data/profile'
import { useRecomputeNetWorth } from '../data/netWorth'
import {
  FX_ADAPTER_OPTIONS,
  PRICE_ADAPTER_OPTIONS,
  loadAdapterSettings,
  saveAdapterSettings,
  type AdapterSettings,
} from '../lib/adapters'
import { COMMON_CURRENCIES } from '../lib/fx'
import { formatMoney, parseMoneyInput } from '../lib/money'
import { formatDate, todayISO } from '../lib/dates'
import { describeError } from '../lib/supabase'

/**
 * Price and FX configuration, plus the manual entry that is the default and
 * must always work. The application stays fully usable with every integration
 * disabled, which is why manual entry is not hidden behind the adapter choice.
 */
export function PricesAndFx() {
  const [settings, setSettings] = useState<AdapterSettings>(() => loadAdapterSettings())
  const [warnings, setWarnings] = useState<string[]>([])

  const holdings = useHoldings()
  const prices = usePricePoints()
  const fxRates = useFxRates()
  const accounts = useAccounts()
  const profile = useProfile()
  const baseCurrency = useBaseCurrency()
  const refreshPrices = useRefreshPrices()
  const refreshFx = useRefreshFxRates()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  function update(patch: Partial<AdapterSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveAdapterSettings(next)
  }

  /** Currencies actually in use, so the FX section only offers what matters. */
  const neededCurrencies = useMemo(() => {
    const codes = new Set<string>()
    for (const account of accounts.data ?? []) codes.add(account.currency)
    for (const holding of holdings.data ?? []) codes.add(holding.currency)
    if (profile.data?.secondary_currency) codes.add(profile.data.secondary_currency)
    codes.delete(baseCurrency)
    return [...codes]
  }, [accounts.data, holdings.data, profile.data, baseCurrency])

  const usesApi = settings.priceAdapterId !== 'manual' || settings.fxAdapterId !== 'manual'

  return (
    <div className="space-y-5">
      {warnings.length > 0 && <WarningBanner messages={warnings} />}

      <Card>
        <CardHeader
          title="Data sources"
          subtitle="Manual entry is the default and always works. Everything else is optional."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Security prices">
            {(props) => (
              <Select
                {...props}
                value={settings.priceAdapterId}
                onChange={(event) => update({ priceAdapterId: event.target.value })}
              >
                {PRICE_ADAPTER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Exchange rates">
            {(props) => (
              <Select
                {...props}
                value={settings.fxAdapterId}
                onChange={(event) => update({ fxAdapterId: event.target.value })}
              >
                {FX_ADAPTER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {usesApi && (
            <Field
              label="API key"
              className="sm:col-span-2"
              hint="Stored in this browser only — never sent to the database, and never included in your export."
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={settings.apiKey}
                  autoComplete="off"
                  placeholder="Your own API key"
                  onChange={(event) => update({ apiKey: event.target.value })}
                />
              )}
            </Field>
          )}
        </div>

        {usesApi && (
          <div className="border-t border-line px-4 py-3 text-xs text-content-muted">
            <p className="font-medium text-caution">This integration is unverified.</p>
            <p className="mt-1">
              The scope of work asked for one API adapter chosen after checking what currently works
              and what its licence permits. That check could not be completed during the build — the
              build environment blocks outbound requests to third-party hosts — so nothing about it has
              been confirmed by testing. Two things need to be true, and both are worth checking before
              you rely on it:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>
                The provider must allow cross-origin browser requests. This app has no backend, so the
                browser calls the API directly; if the response lacks the right CORS header the request
                is blocked and you will see “Failed to fetch”.
              </li>
              <li>
                ASX coverage and the free tier's licence terms and rate limits are yours to confirm.
                Free tiers are generally for personal, non-commercial use.
              </li>
            </ul>
            <p className="mt-2">If it does not work, manual entry is unaffected.</p>
          </div>
        )}
      </Card>

      <ManualPrices
        onRefresh={async () => {
          try {
            const result = await refreshPrices.mutateAsync(holdings.data ?? [])
            setWarnings(result.warnings)
            await recompute.mutateAsync()
            notify(
              result.fetched > 0
                ? `Fetched ${result.fetched} price${result.fetched === 1 ? '' : 's'}.`
                : result.skipped > 0
                  ? 'Already fetched today — prices are limited to one fetch per ticker per day.'
                  : 'No prices fetched.',
              { tone: result.fetched > 0 ? 'success' : 'info' },
            )
          } catch (error) {
            notify(describeError(error), { tone: 'error' })
          }
        }}
        refreshing={refreshPrices.isPending}
        canRefresh={settings.priceAdapterId !== 'manual'}
        prices={prices.data ?? []}
        tickers={[...new Set((holdings.data ?? []).map((holding) => holding.ticker))]}
        baseCurrency={baseCurrency}
      />

      <ManualFxRates
        rates={fxRates.data ?? []}
        baseCurrency={baseCurrency}
        needed={neededCurrencies}
        refreshing={refreshFx.isPending}
        canRefresh={settings.fxAdapterId !== 'manual'}
        onRefresh={async () => {
          try {
            const result = await refreshFx.mutateAsync({ base: baseCurrency, quotes: neededCurrencies })
            setWarnings(result.warnings)
            await recompute.mutateAsync()
            notify(
              result.fetched > 0 ? `Fetched ${result.fetched} rates.` : 'No rates fetched.',
              { tone: result.fetched > 0 ? 'success' : 'info' },
            )
          } catch (error) {
            notify(describeError(error), { tone: 'error' })
          }
        }}
      />
    </div>
  )
}

function ManualPrices({
  prices,
  tickers,
  baseCurrency,
  onRefresh,
  refreshing,
  canRefresh,
}: {
  prices: ReturnType<typeof usePricePoints>['data'] & object
  tickers: string[]
  baseCurrency: string
  onRefresh: () => void
  refreshing: boolean
  canRefresh: boolean
}) {
  const savePrice = useSavePrice()
  const deletePrice = useDeletePrice()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const [ticker, setTicker] = useState('')
  const [asAt, setAsAt] = useState(todayISO())
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState(baseCurrency)

  // Most recent price per ticker, which is what the valuation actually uses.
  const latest = useMemo(() => {
    const map = new Map<string, (typeof prices)[number]>()
    for (const point of prices) {
      const existing = map.get(point.ticker)
      if (!existing || point.as_at > existing.as_at) map.set(point.ticker, point)
    }
    return [...map.values()].sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [prices])

  async function add() {
    const parsed = parseMoneyInput(price)
    if (!ticker.trim() || !parsed || parsed.lte(0)) {
      notify('Enter a ticker and a price greater than zero.', { tone: 'error' })
      return
    }
    try {
      await savePrice.mutateAsync({
        ticker: ticker.trim().toUpperCase(),
        exchange: ticker.trim().toUpperCase().endsWith('.AX') ? 'ASX' : null,
        asAt,
        price: parsed,
        currency,
      })
      setPrice('')
      await recompute.mutateAsync()
      notify('Price saved.', { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader
        title="Security prices"
        subtitle="Latest price per ticker. Holdings are valued at the most recent price on or before each date."
        action={
          canRefresh ? (
            <Button size="sm" loading={refreshing} onClick={onRefresh}>
              Fetch prices
            </Button>
          ) : undefined
        }
      />

      {latest.length === 0 ? (
        <EmptyState
          title="No prices recorded"
          description={
            tickers.length > 0
              ? `You hold ${tickers.join(', ')}. Until a price is entered, those holdings fall back to their average cost and are flagged as stale.`
              : 'Add holdings to a brokerage account, then record prices for them here.'
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {latest.map((point) => (
            <li key={point.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <span className="text-sm text-content">{point.ticker}</span>
                <Badge tone={point.source === 'api' ? 'brand' : 'neutral'} className="ml-2">
                  {point.source}
                </Badge>
                <p className="text-xs text-content-faint">{formatDate(point.as_at)}</p>
              </div>
              <span className="tabular text-sm font-semibold text-content">
                {formatMoney(point.price, point.currency)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete price for ${point.ticker}`}
                onClick={async () => {
                  try {
                    await deletePrice.mutateAsync(point.id)
                    await recompute.mutateAsync()
                    notify('Price deleted.', { tone: 'success' })
                  } catch (error) {
                    notify(describeError(error), { tone: 'error' })
                  }
                }}
              >
                <Icon name="trash" className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-5">
        <Field label="Ticker">
          {(props) => (
            <Input
              {...props}
              list="known-tickers"
              value={ticker}
              placeholder="VAS.AX"
              onChange={(event) => setTicker(event.target.value)}
            />
          )}
        </Field>
        <datalist id="known-tickers">
          {tickers.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>

        <Field label="As at">
          {(props) => (
            <Input {...props} type="date" value={asAt} onChange={(event) => setAsAt(event.target.value)} />
          )}
        </Field>

        <Field label="Price">
          {(props) => (
            <AmountInput
              {...props}
              value={price}
              placeholder="0.00"
              onChange={(event) => setPrice(event.target.value)}
            />
          )}
        </Field>

        <Field label="Currency">
          {(props) => (
            <Select {...props} value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {[...new Set([baseCurrency, ...COMMON_CURRENCIES])].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex items-end">
          <Button variant="primary" size="sm" loading={savePrice.isPending} onClick={() => void add()}>
            <Icon name="plus" />
            Save price
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ManualFxRates({
  rates,
  baseCurrency,
  needed,
  onRefresh,
  refreshing,
  canRefresh,
}: {
  rates: ReturnType<typeof useFxRates>['data'] & object
  baseCurrency: string
  needed: string[]
  onRefresh: () => void
  refreshing: boolean
  canRefresh: boolean
}) {
  const saveRate = useSaveFxRate()
  const deleteRate = useDeleteFxRate()
  const recompute = useRecomputeNetWorth()
  const { notify } = useToast()

  const [base, setBase] = useState(baseCurrency)
  const [quote, setQuote] = useState(needed[0] ?? 'USD')
  const [asAt, setAsAt] = useState(todayISO())
  const [rate, setRate] = useState('')

  const latest = useMemo(() => {
    const map = new Map<string, (typeof rates)[number]>()
    for (const entry of rates) {
      const key = `${entry.base_currency}/${entry.quote_currency}`
      const existing = map.get(key)
      if (!existing || entry.as_at > existing.as_at) map.set(key, entry)
    }
    return [...map.values()]
  }, [rates])

  const missing = needed.filter(
    (code) =>
      !latest.some(
        (entry) =>
          (entry.base_currency === baseCurrency && entry.quote_currency === code) ||
          (entry.quote_currency === baseCurrency && entry.base_currency === code),
      ),
  )

  async function add() {
    const parsed = parseMoneyInput(rate)
    if (!parsed || parsed.lte(0)) {
      notify('Enter a rate greater than zero.', { tone: 'error' })
      return
    }
    if (base === quote) {
      notify('Pick two different currencies.', { tone: 'error' })
      return
    }
    try {
      await saveRate.mutateAsync({ base, quote, asAt, rate: parsed })
      setRate('')
      await recompute.mutateAsync()
      notify('Rate saved.', { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader
        title="Exchange rates"
        subtitle={`Everything is converted into ${baseCurrency}. If no rate exists for a date, the most recent earlier one is used and flagged.`}
        action={
          canRefresh ? (
            <Button size="sm" loading={refreshing} onClick={onRefresh}>
              Fetch rates
            </Button>
          ) : undefined
        }
      />

      {missing.length > 0 && (
        <p className="border-b border-line bg-caution/5 px-4 py-2 text-xs text-caution">
          No rate for {missing.join(', ')} — amounts in {missing.length === 1 ? 'that currency' : 'those currencies'} are
          shown unconverted and flagged on the dashboard.
        </p>
      )}

      {latest.length === 0 ? (
        <EmptyState
          title="No exchange rates recorded"
          description={
            needed.length > 0
              ? `You have amounts in ${needed.join(', ')}. Add a rate so they can be converted into ${baseCurrency}.`
              : `Everything is already in ${baseCurrency}, so no rates are needed.`
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {latest.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <span className="text-sm text-content">
                  1 {entry.base_currency} = {entry.rate} {entry.quote_currency}
                </span>
                <p className="text-xs text-content-faint">
                  {formatDate(entry.as_at)} · {entry.source}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete rate ${entry.base_currency} to ${entry.quote_currency}`}
                onClick={async () => {
                  try {
                    await deleteRate.mutateAsync(entry.id)
                    await recompute.mutateAsync()
                    notify('Rate deleted.', { tone: 'success' })
                  } catch (error) {
                    notify(describeError(error), { tone: 'error' })
                  }
                }}
              >
                <Icon name="trash" className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-5">
        <Field label="From">
          {(props) => (
            <Select {...props} value={base} onChange={(event) => setBase(event.target.value)}>
              {[...new Set([baseCurrency, ...COMMON_CURRENCIES])].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="To">
          {(props) => (
            <Select {...props} value={quote} onChange={(event) => setQuote(event.target.value)}>
              {[...new Set([...needed, ...COMMON_CURRENCIES])].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="As at">
          {(props) => (
            <Input {...props} type="date" value={asAt} onChange={(event) => setAsAt(event.target.value)} />
          )}
        </Field>
        <Field label="Rate" hint={`1 ${base} = ? ${quote}`}>
          {(props) => (
            <AmountInput
              {...props}
              value={rate}
              placeholder="0.00000000"
              onChange={(event) => setRate(event.target.value)}
            />
          )}
        </Field>
        <div className="flex items-end">
          <Button variant="primary" size="sm" loading={saveRate.isPending} onClick={() => void add()}>
            <Icon name="plus" />
            Save rate
          </Button>
        </div>
      </div>
    </Card>
  )
}
