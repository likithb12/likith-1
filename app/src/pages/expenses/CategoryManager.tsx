import { useState } from 'react'
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '../../ui/primitives'
import { EmptyState, SkeletonRows } from '../../ui/feedback'
import { ConfirmDialog } from '../../ui/Modal'
import { Icon } from '../../ui/Icon'
import { useToast } from '../../ui/toast'
import {
  groupCategories,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useSeedCategories,
} from '../../data/categories'
import { describeError } from '../../lib/supabase'
import type { Category, CategoryKind } from '../../types'

export function CategoryManager() {
  const categories = useCategories()
  const createCategory = useCreateCategory()
  const deleteCategory = useDeleteCategory()
  const seedCategories = useSeedCategories()
  const { notify } = useToast()

  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [parentId, setParentId] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null)

  const all = categories.data ?? []
  const grouped = groupCategories(all)
  const parents = all.filter((category) => category.parent_id === null)

  async function add() {
    if (!name.trim()) return
    try {
      await createCategory.mutateAsync({
        name: name.trim(),
        // One level of nesting only: a child's parent is always a top-level
        // category, so picking a child as the parent is not offered.
        parent_id: parentId || null,
        kind,
        colour: null,
      })
      setName('')
      notify('Category added.', { tone: 'success' })
    } catch (error) {
      notify(describeError(error), { tone: 'error' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="New category" subtitle="One level of subcategories is supported." />
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Name" className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                value={name}
                placeholder="Groceries"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void add()
                }}
              />
            )}
          </Field>

          <Field label="Kind">
            {(props) => (
              <Select {...props} value={kind} onChange={(event) => setKind(event.target.value as CategoryKind)}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </Select>
            )}
          </Field>

          <Field label="Parent">
            {(props) => (
              <Select {...props} value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Top level</option>
                {parents
                  .filter((category) => category.kind === kind)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="flex justify-end border-t border-line px-4 py-3">
          <Button variant="primary" size="sm" loading={createCategory.isPending} onClick={() => void add()}>
            <Icon name="plus" />
            Add category
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Categories" subtitle={`${all.length} in total`} />

        {categories.isLoading ? (
          <SkeletonRows rows={5} />
        ) : all.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Start with a common set and adjust it, or add your own above."
            action={
              <Button
                variant="primary"
                loading={seedCategories.isPending}
                onClick={async () => {
                  try {
                    const count = await seedCategories.mutateAsync()
                    notify(`Added ${count} starter categories.`, { tone: 'success' })
                  } catch (error) {
                    notify(describeError(error), { tone: 'error' })
                  }
                }}
              >
                Add starter categories
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {grouped.map(({ parent, children }) => (
              <li key={parent.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-content">{parent.name}</span>
                  <Badge tone={parent.kind === 'income' ? 'positive' : 'neutral'}>{parent.kind}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${parent.name}`}
                    onClick={() => setConfirmDelete(parent)}
                  >
                    <Icon name="trash" className="size-3.5" />
                  </Button>
                </div>

                {children.length > 0 && (
                  <ul className="mt-1 space-y-1 border-l border-line pl-3">
                    {children.map((child) => (
                      <li key={child.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-content-muted">{child.name}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${child.name}`}
                          onClick={() => setConfirmDelete(child)}
                        >
                          <Icon name="trash" className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        busy={deleteCategory.isPending}
        title="Delete this category?"
        confirmLabel="Delete"
        message={
          <>
            <p>
              <strong className="text-content">{confirmDelete?.name}</strong> will be removed.
            </p>
            <p className="mt-2">
              Transactions in it are kept — they simply become uncategorised. No spending history is lost.
            </p>
          </>
        }
        onConfirm={async () => {
          if (!confirmDelete) return
          try {
            await deleteCategory.mutateAsync(confirmDelete.id)
            setConfirmDelete(null)
            notify('Category deleted.', { tone: 'success' })
          } catch (error) {
            notify(describeError(error), { tone: 'error' })
          }
        }}
      />
    </div>
  )
}
