import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { fetchAllPages } from './rows'

/**
 * Full data export and import.
 *
 * "The user must be able to leave" — so this covers every table, round-trips
 * through the same format, and does not depend on anything server-side.
 */

export const EXPORT_FORMAT = 'networth-tracker-export'
export const EXPORT_VERSION = 1

/**
 * Insert order. Parents before children: a row cannot reference an id that has
 * not been inserted yet.
 */
const TABLES = [
  'profiles',
  'accounts',
  'categories',
  'csv_import_profiles',
  'import_batches',
  'transactions',
  'budgets',
  'categorisation_rules',
  'obligations',
  'obligation_payments',
  'income_sources',
  'income_events',
  'holdings',
  'price_points',
  'fx_rates',
  'balance_snapshots',
  'net_worth_snapshots',
] as const

type TableName = (typeof TABLES)[number]

/**
 * Foreign keys to rewrite on import, as [column, table whose id it points at].
 * Ids are regenerated so an import cannot collide with rows that already
 * exist; every reference has to be remapped to match.
 */
const FOREIGN_KEYS: Partial<Record<TableName, [string, TableName][]>> = {
  balance_snapshots: [['account_id', 'accounts']],
  holdings: [['account_id', 'accounts']],
  categories: [['parent_id', 'categories']],
  csv_import_profiles: [['default_account_id', 'accounts']],
  import_batches: [
    ['account_id', 'accounts'],
    ['profile_id', 'csv_import_profiles'],
  ],
  transactions: [
    ['account_id', 'accounts'],
    ['category_id', 'categories'],
    ['import_batch_id', 'import_batches'],
    ['transfer_pair_id', 'transactions'],
  ],
  budgets: [['category_id', 'categories']],
  categorisation_rules: [['category_id', 'categories']],
  obligations: [['linked_account_id', 'accounts']],
  obligation_payments: [
    ['obligation_id', 'obligations'],
    ['transaction_id', 'transactions'],
  ],
  income_events: [
    ['income_source_id', 'income_sources'],
    ['account_id', 'accounts'],
    ['transaction_id', 'transactions'],
  ],
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  exported_at: string
  data: Partial<Record<TableName, Record<string, unknown>[]>>
}

async function readTable(supabase: SupabaseClient, table: TableName) {
  return fetchAllPages<Record<string, unknown>>((from, to) =>
    supabase.from(table).select('*').range(from, to),
  )
}

export function useExportData() {
  return useMutation({
    mutationFn: async (): Promise<ExportFile> => {
      const supabase = requireSupabase()
      const data: ExportFile['data'] = {}

      for (const table of TABLES) {
        data[table] = await readTable(supabase, table)
      }

      return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exported_at: new Date().toISOString(),
        data,
      }
    },
  })
}

/** Trigger a browser download of the export. */
export function downloadExport(file: ExportFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `networth-export-${file.exported_at.slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export class ImportFormatError extends Error {}

export function parseExportFile(text: string): ExportFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ImportFormatError('That file is not valid JSON.')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ImportFormatError('That file does not look like an export.')
  }

  const file = parsed as Partial<ExportFile>
  if (file.format !== EXPORT_FORMAT) {
    throw new ImportFormatError(
      'That file was not produced by this app — the "format" marker does not match.',
    )
  }
  if (typeof file.version !== 'number' || file.version > EXPORT_VERSION) {
    throw new ImportFormatError(
      `That export is version ${String(file.version)}, which this build is too old to read.`,
    )
  }
  if (typeof file.data !== 'object' || file.data === null) {
    throw new ImportFormatError('That export has no data section.')
  }

  return file as ExportFile
}

export interface ImportResult {
  inserted: Partial<Record<TableName, number>>
  total: number
}

export function useImportData() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({
      file,
      replaceExisting,
    }: {
      file: ExportFile
      replaceExisting: boolean
    }): Promise<ImportResult> => {
      const supabase = requireSupabase()

      if (replaceExisting) {
        // Reverse order: children before parents.
        for (const table of [...TABLES].reverse()) {
          if (table === 'profiles') continue // Deleting the profile row would orphan the session.
          const { error } = await supabase.from(table).delete().eq('user_id', userId)
          if (error) throw error
        }
      }

      const idMap = new Map<TableName, Map<string, string>>()
      const inserted: Partial<Record<TableName, number>> = {}
      let total = 0

      for (const table of TABLES) {
        const rows = file.data[table]
        if (!rows || rows.length === 0) continue

        if (table === 'profiles') {
          // The profile row already exists for this user; carry across the
          // settings rather than inserting a duplicate.
          const source = rows[0]
          if (source) {
            const { error } = await supabase
              .from('profiles')
              .update({
                display_name: source.display_name ?? null,
                base_currency: source.base_currency ?? 'AUD',
                secondary_currency: source.secondary_currency ?? null,
              })
              .eq('user_id', userId)
            if (error) throw error
          }
          continue
        }

        const tableMap = new Map<string, string>()
        idMap.set(table, tableMap)

        const prepared = rows.map((row) => {
          const next: Record<string, unknown> = { ...row }
          const oldId = typeof row.id === 'string' ? row.id : null
          const newId = crypto.randomUUID()
          if (oldId) tableMap.set(oldId, newId)
          next.id = newId
          next.user_id = userId
          return next
        })

        // Remap foreign keys now that every id in this table is known. Keys
        // pointing at the same table (categories.parent_id,
        // transactions.transfer_pair_id) resolve against the map just built.
        for (const row of prepared) {
          for (const [column, targetTable] of FOREIGN_KEYS[table] ?? []) {
            const value = row[column]
            if (typeof value !== 'string') continue
            const target = targetTable === table ? tableMap : idMap.get(targetTable)
            // A reference we cannot resolve becomes null rather than a
            // dangling id that would fail the foreign key.
            row[column] = target?.get(value) ?? null
          }
        }

        // Chunked so a large history does not exceed the request size limit.
        const CHUNK = 500
        for (let start = 0; start < prepared.length; start += CHUNK) {
          const chunk = prepared.slice(start, start + CHUNK)
          const { error } = await supabase.from(table).insert(chunk)
          if (error) throw error
        }

        inserted[table] = prepared.length
        total += prepared.length
      }

      return { inserted, total }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
