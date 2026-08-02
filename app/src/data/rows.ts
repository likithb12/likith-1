/**
 * Row normalisation between PostgREST and the domain types.
 *
 * PostgREST serialises `numeric` as a JSON number. The domain types keep every
 * amount as a string so nothing downstream can accidentally do float
 * arithmetic on it — see DECISIONS.md D9.
 */

/** Numeric column → string, preserving null. */
export function numStr(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

/** Numeric column → string, defaulting to "0". */
export function numStrOr0(value: unknown): string {
  return numStr(value) ?? '0'
}

/**
 * Convert the named numeric columns of a row to strings.
 * Returns a new object; the input is not mutated.
 */
export function normaliseRow<T extends Record<string, unknown>>(
  row: T,
  numericFields: readonly string[],
): T {
  const out: Record<string, unknown> = { ...row }
  for (const field of numericFields) {
    if (field in out) out[field] = numStr(out[field])
  }
  return out as T
}

export function normaliseRows<T extends Record<string, unknown>>(
  rows: T[] | null,
  numericFields: readonly string[],
): T[] {
  return (rows ?? []).map((row) => normaliseRow(row, numericFields))
}

/**
 * PostgREST caps a single response at 1000 rows by default. Paging keeps a
 * long history from being silently truncated — which would quietly corrupt
 * the net worth trend rather than failing loudly.
 */
export const PAGE_SIZE = 1000

export async function fetchAllPages<T>(
  // PostgREST's builder is thenable but is not a Promise, so the parameter is
  // typed as PromiseLike to accept it directly without an await-and-wrap.
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return all
}
