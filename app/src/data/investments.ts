import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages, normaliseRows } from './rows'
import { toDb, toDbOrNull, UNIT_SCALE, RATE_SCALE, type Numeric } from '../lib/money'
import { todayISO, type ISODate } from '../lib/dates'
import { loadAdapterSettings, resolveFxAdapter, resolvePriceAdapter } from '../lib/adapters'
import type { FxRate, Holding, PricePoint } from '../types'

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export function useHoldings() {
  return useQuery({
    queryKey: queryKeys.holdings,
    queryFn: async (): Promise<Holding[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<Holding>((from, to) =>
        supabase.from('holdings').select('*').order('ticker').range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'units',
        'avg_cost_per_unit',
      ]) as unknown as Holding[]
    },
  })
}

export interface HoldingInput {
  account_id: string
  ticker: string
  exchange: string | null
  units: Numeric
  avg_cost_per_unit: Numeric | null
  currency: string
}

export function useSaveHolding() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: HoldingInput }) => {
      const supabase = requireSupabase()
      const row = {
        ...input,
        ticker: input.ticker.trim().toUpperCase(),
        units: toDb(input.units, UNIT_SCALE),
        avg_cost_per_unit: toDbOrNull(input.avg_cost_per_unit, UNIT_SCALE),
      }

      if (id) {
        const { error } = await supabase.from('holdings').update(row).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('holdings')
        .insert({ ...row, user_id: userId })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeleteHolding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('holdings').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export function usePricePoints() {
  return useQuery({
    queryKey: queryKeys.pricePoints,
    queryFn: async (): Promise<PricePoint[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<PricePoint>((from, to) =>
        supabase.from('price_points').select('*').order('as_at').range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], [
        'price',
      ]) as unknown as PricePoint[]
    },
  })
}

export function useSavePrice() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({
      ticker,
      exchange,
      asAt,
      price,
      currency,
      source = 'manual',
    }: {
      ticker: string
      exchange: string | null
      asAt: ISODate
      price: Numeric
      currency: string
      source?: 'manual' | 'api'
    }) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('price_points').upsert(
        {
          user_id: userId,
          ticker: ticker.trim().toUpperCase(),
          exchange,
          as_at: asAt,
          price: toDb(price, UNIT_SCALE),
          currency,
          source,
        },
        { onConflict: 'user_id,ticker,as_at' },
      )
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeletePrice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('price_points').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export interface RefreshResult {
  fetched: number
  skipped: number
  warnings: string[]
}

/**
 * Fetch prices through the configured adapter.
 *
 * Never runs on render — it is only ever triggered by an explicit action. A
 * ticker that already has a price for today is skipped, which enforces the
 * "at most once per ticker per day" rule from §5.1.
 */
export function useRefreshPrices() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (holdings: Holding[]): Promise<RefreshResult> => {
      const supabase = requireSupabase()
      const settings = loadAdapterSettings()
      const adapter = resolvePriceAdapter(settings.priceAdapterId, settings.apiKey)
      const today = todayISO()

      if (adapter.id === 'manual') {
        return {
          fetched: 0,
          skipped: 0,
          warnings: ['The price source is set to manual entry, so there is nothing to fetch.'],
        }
      }
      if (!adapter.isConfigured()) {
        return { fetched: 0, skipped: 0, warnings: ['The price source needs an API key.'] }
      }

      const tickers = [...new Set(holdings.map((holding) => holding.ticker.toUpperCase()))]

      const { data: existing, error: existingError } = await supabase
        .from('price_points')
        .select('ticker')
        .eq('as_at', today)
      if (existingError) throw existingError

      const alreadyToday = new Set(
        (existing ?? []).map((row) => (row as { ticker: string }).ticker.toUpperCase()),
      )
      const needed = tickers.filter((ticker) => !alreadyToday.has(ticker))
      const skipped = tickers.length - needed.length

      if (needed.length === 0) {
        return { fetched: 0, skipped, warnings: [] }
      }

      const result = await adapter.fetchLatest(needed)
      if (result.quotes.length === 0) {
        return { fetched: 0, skipped, warnings: result.warnings }
      }

      const currencyFor = new Map(holdings.map((holding) => [holding.ticker.toUpperCase(), holding.currency]))

      const rows = result.quotes.map((quote) => ({
        user_id: userId,
        ticker: quote.ticker.toUpperCase(),
        exchange: holdings.find((h) => h.ticker.toUpperCase() === quote.ticker.toUpperCase())?.exchange ?? null,
        as_at: quote.as_at,
        price: toDb(quote.price, UNIT_SCALE),
        // The adapter does not state a currency, so the holding's own currency
        // governs rather than a guess.
        currency: quote.currency || currencyFor.get(quote.ticker.toUpperCase()) || 'AUD',
        source: 'api' as const,
      }))

      const { error } = await supabase
        .from('price_points')
        .upsert(rows, { onConflict: 'user_id,ticker,as_at' })
      if (error) throw error

      return { fetched: rows.length, skipped, warnings: result.warnings }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

// ---------------------------------------------------------------------------
// FX rates
// ---------------------------------------------------------------------------

export function useFxRates() {
  return useQuery({
    queryKey: queryKeys.fxRates,
    queryFn: async (): Promise<FxRate[]> => {
      const supabase = requireSupabase()
      const rows = await fetchAllPages<FxRate>((from, to) =>
        supabase.from('fx_rates').select('*').order('as_at').range(from, to),
      )
      return normaliseRows(rows as unknown as Record<string, unknown>[], ['rate']) as unknown as FxRate[]
    },
  })
}

export function useSaveFxRate() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({
      base,
      quote,
      asAt,
      rate,
      source = 'manual',
    }: {
      base: string
      quote: string
      asAt: ISODate
      rate: Numeric
      source?: string
    }) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('fx_rates').upsert(
        {
          user_id: userId,
          base_currency: base.toUpperCase(),
          quote_currency: quote.toUpperCase(),
          as_at: asAt,
          rate: toDb(rate, RATE_SCALE),
          source,
        },
        { onConflict: 'user_id,base_currency,quote_currency,as_at' },
      )
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDeleteFxRate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('fx_rates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useRefreshFxRates() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({
      base,
      quotes,
    }: {
      base: string
      quotes: string[]
    }): Promise<RefreshResult> => {
      const supabase = requireSupabase()
      const settings = loadAdapterSettings()
      const adapter = resolveFxAdapter(settings.fxAdapterId, settings.apiKey)
      const today = todayISO()

      if (adapter.id === 'manual') {
        return {
          fetched: 0,
          skipped: 0,
          warnings: ['The FX source is set to manual entry, so there is nothing to fetch.'],
        }
      }
      if (!adapter.isConfigured()) {
        return { fetched: 0, skipped: 0, warnings: ['The FX source needs an API key.'] }
      }

      const { data: existing, error: existingError } = await supabase
        .from('fx_rates')
        .select('quote_currency')
        .eq('as_at', today)
        .eq('base_currency', base.toUpperCase())
      if (existingError) throw existingError

      const alreadyToday = new Set(
        (existing ?? []).map((row) => (row as { quote_currency: string }).quote_currency.toUpperCase()),
      )
      const needed = quotes.filter((code) => code !== base && !alreadyToday.has(code.toUpperCase()))
      const skipped = quotes.length - needed.length

      if (needed.length === 0) return { fetched: 0, skipped, warnings: [] }

      const result = await adapter.fetchLatest(base, needed)
      if (result.quotes.length === 0) {
        return { fetched: 0, skipped, warnings: result.warnings }
      }

      const rows = result.quotes.map((quote) => ({
        user_id: userId,
        base_currency: quote.base_currency.toUpperCase(),
        quote_currency: quote.quote_currency.toUpperCase(),
        as_at: quote.as_at,
        rate: toDb(quote.rate, RATE_SCALE),
        source: quote.source,
      }))

      const { error } = await supabase
        .from('fx_rates')
        .upsert(rows, { onConflict: 'user_id,base_currency,quote_currency,as_at' })
      if (error) throw error

      return { fetched: rows.length, skipped, warnings: result.warnings }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
