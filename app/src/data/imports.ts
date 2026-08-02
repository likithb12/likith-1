import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages } from './rows'
import { assignDedupeHashes, countExistingByBaseHash, type HashedRow } from '../lib/dedupe'
import { categoriseDescription, orderRules, type RuleLike } from '../lib/rules'
import type { DraftTransaction } from '../lib/importer'
import type { CategorisationRule, CsvImportProfile, ImportBatch } from '../types'

// ---------------------------------------------------------------------------
// CSV import profiles
// ---------------------------------------------------------------------------

export function useCsvProfiles() {
  return useQuery({
    queryKey: queryKeys.csvProfiles,
    queryFn: async (): Promise<CsvImportProfile[]> => {
      const supabase = requireSupabase()
      return fetchAllPages<CsvImportProfile>((from, to) =>
        supabase.from('csv_import_profiles').select('*').order('name').range(from, to),
      )
    },
    staleTime: 60_000,
  })
}

export type CsvProfileInput = Omit<CsvImportProfile, 'id' | 'user_id' | 'created_at'>

export function useSaveCsvProfile() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: CsvProfileInput }) => {
      const supabase = requireSupabase()
      if (id) {
        const { error } = await supabase.from('csv_import_profiles').update(input).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('csv_import_profiles')
        .insert({ ...input, user_id: userId })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.csvProfiles }),
  })
}

export function useDeleteCsvProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('csv_import_profiles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.csvProfiles }),
  })
}

// ---------------------------------------------------------------------------
// Categorisation rules
// ---------------------------------------------------------------------------

export function useCategorisationRules() {
  return useQuery({
    queryKey: queryKeys.categorisationRules,
    queryFn: async (): Promise<CategorisationRule[]> => {
      const supabase = requireSupabase()
      return fetchAllPages<CategorisationRule>((from, to) =>
        supabase.from('categorisation_rules').select('*').order('priority').range(from, to),
      )
    },
    staleTime: 60_000,
  })
}

export type RuleInput = Omit<CategorisationRule, 'id' | 'user_id' | 'created_at'>

export function useSaveRule() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: RuleInput }) => {
      const supabase = requireSupabase()
      if (id) {
        const { error } = await supabase.from('categorisation_rules').update(input).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('categorisation_rules')
        .insert({ ...input, user_id: userId })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categorisationRules }),
  })
}

export function useDeleteRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('categorisation_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categorisationRules }),
  })
}

/**
 * Re-run the rules over transactions that have no category yet.
 *
 * Only touches uncategorised rows: a rule change must never silently
 * overwrite a category the user set by hand.
 */
export function useApplyRulesRetroactively() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<number> => {
      const supabase = requireSupabase()

      const rules = await fetchAllPages<CategorisationRule>((from, to) =>
        supabase.from('categorisation_rules').select('*').order('priority').range(from, to),
      )
      if (rules.length === 0) return 0

      const pending = await fetchAllPages<{ id: string; description: string | null; description_raw: string | null }>(
        (from, to) =>
          supabase
            .from('transactions')
            .select('id, description, description_raw')
            .is('category_id', null)
            .range(from, to),
      )

      const ordered = orderRules(rules as unknown as RuleLike[])
      const updates = new Map<string, string[]>()

      for (const transaction of pending) {
        const text = transaction.description || transaction.description_raw || ''
        const categoryId = categoriseDescription(text, ordered, true)
        if (!categoryId) continue
        const list = updates.get(categoryId)
        if (list) list.push(transaction.id)
        else updates.set(categoryId, [transaction.id])
      }

      let changed = 0
      // Grouped by target category so this is one request per category
      // rather than one per transaction.
      for (const [categoryId, ids] of updates) {
        for (let start = 0; start < ids.length; start += 500) {
          const chunk = ids.slice(start, start + 500)
          const { error } = await supabase
            .from('transactions')
            .update({ category_id: categoryId })
            .in('id', chunk)
          if (error) throw error
          changed += chunk.length
        }
      }

      return changed
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
  })
}

// ---------------------------------------------------------------------------
// Import batches
// ---------------------------------------------------------------------------

export function useImportBatches() {
  return useQuery({
    queryKey: queryKeys.importBatches,
    queryFn: async (): Promise<ImportBatch[]> => {
      const supabase = requireSupabase()
      return fetchAllPages<ImportBatch>((from, to) =>
        supabase
          .from('import_batches')
          .select('*')
          .order('imported_at', { ascending: false })
          .range(from, to),
      )
    },
  })
}

export interface DuplicateReport {
  hashed: HashedRow<DraftTransaction>[]
  newRows: HashedRow<DraftTransaction>[]
  duplicates: HashedRow<DraftTransaction>[]
}

/**
 * Work out which drafts are new, before anything is written.
 *
 * Existing hashes are read for the same account across the date span of the
 * file — that is exactly the set the base hash could collide with, so it is
 * both complete and small.
 */
export async function buildDuplicateReport(
  userId: string,
  accountId: string,
  drafts: DraftTransaction[],
): Promise<DuplicateReport> {
  const supabase = requireSupabase()

  if (drafts.length === 0) return { hashed: [], newRows: [], duplicates: [] }

  const dates = drafts.map((draft) => draft.txn_date).sort()
  const first = dates[0]!
  const last = dates[dates.length - 1]!

  const existing = await fetchAllPages<{ dedupe_hash: string }>((from, to) =>
    supabase
      .from('transactions')
      .select('dedupe_hash')
      .eq('account_id', accountId)
      .gte('txn_date', first)
      .lte('txn_date', last)
      .range(from, to),
  )

  const counts = countExistingByBaseHash(existing.map((row) => row.dedupe_hash))

  const hashed = await assignDedupeHashes(
    drafts,
    (draft) => ({
      userId,
      accountId,
      txnDate: draft.txn_date,
      amount: draft.amount,
      descriptionRaw: draft.description_raw,
    }),
    counts,
  )

  return {
    hashed,
    newRows: hashed.filter((row) => !row.isDuplicate),
    duplicates: hashed.filter((row) => row.isDuplicate),
  }
}

export interface CommitImportInput {
  accountId: string
  profileId: string | null
  filename: string
  currency: string
  report: DuplicateReport
  rowsFailed: number
}

export interface CommitImportResult {
  batchId: string
  imported: number
  skippedDuplicates: number
  categorised: number
}

export function useCommitImport() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (input: CommitImportInput): Promise<CommitImportResult> => {
      const supabase = requireSupabase()

      const rules = await fetchAllPages<CategorisationRule>((from, to) =>
        supabase.from('categorisation_rules').select('*').order('priority').range(from, to),
      )
      const ordered = orderRules(rules as unknown as RuleLike[])

      const { data: batch, error: batchError } = await supabase
        .from('import_batches')
        .insert({
          user_id: userId,
          account_id: input.accountId,
          profile_id: input.profileId,
          filename: input.filename,
          rows_total: input.report.hashed.length + input.rowsFailed,
          rows_imported: 0,
          rows_skipped_duplicate: input.report.duplicates.length,
          rows_failed: input.rowsFailed,
        })
        .select('id')
        .single()
      if (batchError) throw batchError

      const batchId = (batch as { id: string }).id
      let categorised = 0

      const rows = input.report.newRows.map((entry) => {
        const draft = entry.row
        const categoryId = ordered.length > 0 ? categoriseDescription(draft.description_raw, ordered, true) : null
        if (categoryId) categorised++

        return {
          user_id: userId,
          account_id: input.accountId,
          txn_date: draft.txn_date,
          amount: draft.amount,
          direction: draft.direction,
          currency: input.currency,
          description_raw: draft.description_raw,
          description: draft.description,
          category_id: categoryId,
          is_transfer: false,
          source: 'csv' as const,
          import_batch_id: batchId,
          dedupe_hash: entry.dedupeHash,
        }
      })

      let imported = 0
      for (let start = 0; start < rows.length; start += 500) {
        const chunk = rows.slice(start, start + 500)
        const { error } = await supabase.from('transactions').insert(chunk)
        if (error) {
          // The batch row already exists; leave it with an accurate count so
          // a partial import is visible and can still be undone.
          await supabase.from('import_batches').update({ rows_imported: imported }).eq('id', batchId)
          throw error
        }
        imported += chunk.length
      }

      const { error: updateError } = await supabase
        .from('import_batches')
        .update({ rows_imported: imported })
        .eq('id', batchId)
      if (updateError) throw updateError

      return {
        batchId,
        imported,
        skippedDuplicates: input.report.duplicates.length,
        categorised,
      }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/** One click undoes an entire batch. */
export function useUndoImport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (batchId: string): Promise<number> => {
      const supabase = requireSupabase()

      const { data, error } = await supabase
        .from('transactions')
        .delete()
        .eq('import_batch_id', batchId)
        .select('id')
      if (error) throw error

      const { error: batchError } = await supabase.from('import_batches').delete().eq('id', batchId)
      if (batchError) throw batchError

      return (data ?? []).length
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
