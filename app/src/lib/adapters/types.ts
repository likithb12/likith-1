import type { ISODate } from '../dates'

/**
 * Adapters for the two external data sources: security prices and FX rates.
 *
 * Both are treated as unreliable. Every adapter has a manual fallback, and the
 * application must remain fully functional with every integration disabled —
 * so nothing in the app may await a fetch in order to render.
 */

export interface PriceQuote {
  ticker: string
  as_at: ISODate
  /** Decimal string. Never a float. */
  price: string
  currency: string
}

export interface FxQuote {
  base_currency: string
  quote_currency: string
  as_at: ISODate
  rate: string
  source: string
}

export interface AdapterResult<T> {
  quotes: T[]
  /** Non-blocking problems, surfaced as warnings rather than thrown. */
  warnings: string[]
}

export interface PriceAdapter {
  readonly id: string
  readonly label: string
  /** False when the adapter needs configuration it does not have. */
  isConfigured(): boolean
  /**
   * Fetch the latest price for each ticker. Implementations must never throw:
   * a failure is a warning plus a missing quote, because the caller falls back
   * to the last known price.
   */
  fetchLatest(tickers: string[]): Promise<AdapterResult<PriceQuote>>
}

export interface FxAdapter {
  readonly id: string
  readonly label: string
  isConfigured(): boolean
  fetchLatest(base: string, quotes: string[]): Promise<AdapterResult<FxQuote>>
}

/** Adapter configuration, stored in localStorage rather than the database. */
export interface AdapterSettings {
  priceAdapterId: string
  fxAdapterId: string
  /**
   * The user's own API key. Deliberately NOT stored in Postgres: it is the
   * user's credential with a third party, it is not needed on another device
   * to read their data, and keeping it out of the database keeps it out of
   * the JSON export and out of anything the platform can read.
   */
  apiKey: string
}

export const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  priceAdapterId: 'manual',
  fxAdapterId: 'manual',
  apiKey: '',
}

const STORAGE_KEY = 'networth.adapters'

export function loadAdapterSettings(): AdapterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_ADAPTER_SETTINGS
    return { ...DEFAULT_ADAPTER_SETTINGS, ...(JSON.parse(raw) as Partial<AdapterSettings>) }
  } catch {
    return DEFAULT_ADAPTER_SETTINGS
  }
}

export function saveAdapterSettings(settings: AdapterSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // A full or disabled localStorage is not worth failing over; the app
    // simply falls back to manual entry.
  }
}
