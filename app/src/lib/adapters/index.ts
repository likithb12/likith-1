import type { AdapterResult, FxAdapter, FxQuote, PriceAdapter, PriceQuote } from './types'
import { todayISO, type ISODate } from '../dates'

export * from './types'

/**
 * Manual adapters — the default, and the reason the app works with every
 * integration switched off. They fetch nothing; prices and rates come from
 * whatever the user typed in.
 */
export const manualPriceAdapter: PriceAdapter = {
  id: 'manual',
  label: 'Manual entry',
  isConfigured: () => true,
  fetchLatest: async () => ({ quotes: [], warnings: [] }),
}

export const manualFxAdapter: FxAdapter = {
  id: 'manual',
  label: 'Manual entry',
  isConfigured: () => true,
  fetchLatest: async () => ({ quotes: [], warnings: [] }),
}

/**
 * Alpha Vantage.
 *
 * ⚠️ UNVERIFIED — read before enabling.
 *
 * §10 of the scope assigned "verify current availability and licence terms
 * before writing code" to this build. That verification could not be
 * completed: the build environment's network policy blocks outbound requests
 * to third-party hosts, so neither Alpha Vantage's ASX symbol coverage nor its
 * CORS headers could be tested. Rather than claim a check that did not happen,
 * the adapter ships disabled, requires the user's own API key, and states what
 * is unconfirmed. See DECISIONS.md D36.
 *
 * Two things must hold for this to work at all, and both are the user's to
 * confirm:
 *
 *  1. **CORS.** This app is a static site with no backend, so the browser
 *     calls the API directly. The response must carry a permissive
 *     Access-Control-Allow-Origin header or the browser blocks it. There is no
 *     workaround that does not involve running a server, which §2 rules out.
 *
 *  2. **Licence and coverage.** The free tier is rate limited (single-digit
 *     calls per minute, a low daily cap) and ASX coverage via a `.AUS` symbol
 *     suffix is not guaranteed. Personal, non-commercial use is what the free
 *     tier is for; anything else needs their paid terms checked.
 *
 * If either fails, the manual adapter remains fully functional — which is
 * exactly why it is the default.
 */
export function createAlphaVantagePriceAdapter(apiKey: string): PriceAdapter {
  return {
    id: 'alphavantage',
    label: 'Alpha Vantage (unverified)',
    isConfigured: () => apiKey.trim().length > 0,

    async fetchLatest(tickers: string[]): Promise<AdapterResult<PriceQuote>> {
      const quotes: PriceQuote[] = []
      const warnings: string[] = []

      if (!apiKey.trim()) {
        return { quotes, warnings: ['No Alpha Vantage API key configured.'] }
      }

      for (const ticker of tickers) {
        try {
          const url = new URL('https://www.alphavantage.co/query')
          url.searchParams.set('function', 'GLOBAL_QUOTE')
          url.searchParams.set('symbol', toAlphaVantageSymbol(ticker))
          url.searchParams.set('apikey', apiKey.trim())

          const response = await fetch(url.toString())
          if (!response.ok) {
            warnings.push(`${ticker}: request failed (${response.status})`)
            continue
          }

          const body = (await response.json()) as Record<string, unknown>

          // The free tier answers 200 with a "Note" or "Information" body when
          // rate limited, rather than an error status.
          const note = (body['Note'] ?? body['Information']) as string | undefined
          if (note) {
            warnings.push(`${ticker}: ${note}`)
            continue
          }

          const quote = body['Global Quote'] as Record<string, string> | undefined
          const price = quote?.['05. price']
          const day = quote?.['07. latest trading day']

          if (!price || !day) {
            warnings.push(`${ticker}: no price in the response — the symbol may not be covered.`)
            continue
          }

          quotes.push({
            ticker,
            as_at: (day as ISODate) || todayISO(),
            price,
            // GLOBAL_QUOTE does not state a currency; the holding's own
            // currency is used by the caller rather than guessed here.
            currency: '',
          })
        } catch (error) {
          // A CORS rejection surfaces here as an opaque TypeError.
          warnings.push(
            `${ticker}: ${error instanceof Error ? error.message : 'request failed'}. If this says "Failed to fetch", the API is most likely refusing cross-origin browser requests.`,
          )
        }
      }

      return { quotes, warnings }
    },
  }
}

/**
 * Alpha Vantage expects ASX symbols with a `.AUS` suffix rather than the
 * `.AX` used locally. Unconfirmed — see the note above.
 */
function toAlphaVantageSymbol(ticker: string): string {
  const upper = ticker.trim().toUpperCase()
  return upper.endsWith('.AX') ? `${upper.slice(0, -3)}.AUS` : upper
}

/** FX via the same provider and the same caveats. */
export function createAlphaVantageFxAdapter(apiKey: string): FxAdapter {
  return {
    id: 'alphavantage',
    label: 'Alpha Vantage (unverified)',
    isConfigured: () => apiKey.trim().length > 0,

    async fetchLatest(base: string, quoteCurrencies: string[]): Promise<AdapterResult<FxQuote>> {
      const quotes: FxQuote[] = []
      const warnings: string[] = []

      if (!apiKey.trim()) {
        return { quotes, warnings: ['No Alpha Vantage API key configured.'] }
      }

      for (const quoteCurrency of quoteCurrencies) {
        if (quoteCurrency === base) continue
        try {
          const url = new URL('https://www.alphavantage.co/query')
          url.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE')
          url.searchParams.set('from_currency', base)
          url.searchParams.set('to_currency', quoteCurrency)
          url.searchParams.set('apikey', apiKey.trim())

          const response = await fetch(url.toString())
          if (!response.ok) {
            warnings.push(`${base}/${quoteCurrency}: request failed (${response.status})`)
            continue
          }

          const body = (await response.json()) as Record<string, unknown>
          const note = (body['Note'] ?? body['Information']) as string | undefined
          if (note) {
            warnings.push(`${base}/${quoteCurrency}: ${note}`)
            continue
          }

          const payload = body['Realtime Currency Exchange Rate'] as Record<string, string> | undefined
          const rate = payload?.['5. Exchange Rate']
          if (!rate) {
            warnings.push(`${base}/${quoteCurrency}: no rate in the response.`)
            continue
          }

          quotes.push({
            base_currency: base,
            quote_currency: quoteCurrency,
            as_at: todayISO(),
            rate,
            source: 'alphavantage',
          })
        } catch (error) {
          warnings.push(
            `${base}/${quoteCurrency}: ${error instanceof Error ? error.message : 'request failed'}.`,
          )
        }
      }

      return { quotes, warnings }
    },
  }
}

export const PRICE_ADAPTER_OPTIONS = [
  { id: 'manual', label: 'Manual entry (recommended)' },
  { id: 'alphavantage', label: 'Alpha Vantage — unverified, needs your API key' },
] as const

export const FX_ADAPTER_OPTIONS = PRICE_ADAPTER_OPTIONS

export function resolvePriceAdapter(id: string, apiKey: string): PriceAdapter {
  return id === 'alphavantage' ? createAlphaVantagePriceAdapter(apiKey) : manualPriceAdapter
}

export function resolveFxAdapter(id: string, apiKey: string): FxAdapter {
  return id === 'alphavantage' ? createAlphaVantageFxAdapter(apiKey) : manualFxAdapter
}
