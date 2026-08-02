import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../lib/supabase'
import { useUserId } from '../auth/AuthProvider'
import { queryKeys } from './keys'
import { fetchAllPages } from './rows'
import type { Category, CategoryKind } from '../types'

export interface CategoryInput {
  name: string
  parent_id: string | null
  kind: CategoryKind
  colour: string | null
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: async (): Promise<Category[]> => {
      const supabase = requireSupabase()
      return fetchAllPages<Category>((from, to) =>
        supabase.from('categories').select('*').order('name').range(from, to),
      )
    },
    staleTime: 60_000,
  })
}

/** Parents with their children attached, for grouped selects and lists. */
export function groupCategories(categories: Category[]) {
  const parents = categories.filter((category) => category.parent_id === null)
  const childrenByParent = new Map<string, Category[]>()

  for (const category of categories) {
    if (!category.parent_id) continue
    const list = childrenByParent.get(category.parent_id)
    if (list) list.push(category)
    else childrenByParent.set(category.parent_id, [category])
  }

  return parents.map((parent) => ({ parent, children: childrenByParent.get(parent.id) ?? [] }))
}

export function useCreateCategory() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (input: CategoryInput): Promise<Category> => {
      const supabase = requireSupabase()
      const { data, error } = await supabase
        .from('categories')
        .insert({ ...input, user_id: userId })
        .select()
        .single()
      if (error) throw error
      return data as Category
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
  })
}

export function useUpdateCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CategoryInput> }) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('categories').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/**
 * Deleting a category leaves its transactions in place but uncategorised —
 * the foreign key is ON DELETE SET NULL. Spending history is never destroyed
 * by tidying up the category list.
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = requireSupabase()
      const { error } = await supabase.from('categories').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

/** A starter set, offered rather than imposed on a new user. */
export const STARTER_CATEGORIES: { name: string; kind: CategoryKind; children?: string[] }[] = [
  { name: 'Groceries', kind: 'expense' },
  { name: 'Eating out', kind: 'expense' },
  { name: 'Transport', kind: 'expense', children: ['Fuel', 'Public transport', 'Rideshare'] },
  { name: 'Housing', kind: 'expense', children: ['Rent or mortgage', 'Utilities', 'Internet'] },
  { name: 'Health', kind: 'expense' },
  { name: 'Insurance', kind: 'expense' },
  { name: 'Subscriptions', kind: 'expense' },
  { name: 'Shopping', kind: 'expense' },
  { name: 'Travel', kind: 'expense' },
  { name: 'Other', kind: 'expense' },
  { name: 'Salary', kind: 'income' },
  { name: 'Interest', kind: 'income' },
  { name: 'Refunds', kind: 'income' },
]

export function useSeedCategories() {
  const queryClient = useQueryClient()
  const userId = useUserId()

  return useMutation({
    mutationFn: async (): Promise<number> => {
      const supabase = requireSupabase()

      const parents = STARTER_CATEGORIES.map((entry) => ({
        user_id: userId,
        name: entry.name,
        kind: entry.kind,
        parent_id: null,
        colour: null,
      }))

      const { data: created, error } = await supabase.from('categories').insert(parents).select()
      if (error) throw error

      const byName = new Map((created as Category[]).map((row) => [row.name, row.id]))
      const children = STARTER_CATEGORIES.flatMap((entry) =>
        (entry.children ?? []).map((childName) => ({
          user_id: userId,
          name: childName,
          kind: entry.kind,
          parent_id: byName.get(entry.name) ?? null,
          colour: null,
        })),
      )

      if (children.length > 0) {
        const { error: childError } = await supabase.from('categories').insert(children)
        if (childError) throw childError
      }

      return parents.length + children.length
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
  })
}
