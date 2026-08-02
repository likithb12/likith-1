import { useMemo } from 'react'
import { Select } from '../../ui/primitives'
import { groupCategories } from '../../data/categories'
import type { Category, CategoryKind } from '../../types'

/**
 * Category picker with one level of nesting, rendered as optgroups so the
 * hierarchy is visible without a custom widget (and stays keyboard-navigable).
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  kind,
  includeBlank = 'Uncategorised',
  id,
  className,
  'aria-label': ariaLabel,
}: {
  categories: Category[]
  value: string | null
  onChange: (categoryId: string | null) => void
  kind?: CategoryKind
  includeBlank?: string | null
  id?: string
  className?: string
  'aria-label'?: string
}) {
  const grouped = useMemo(() => {
    const filtered = kind ? categories.filter((category) => category.kind === kind) : categories
    return groupCategories(filtered)
  }, [categories, kind])

  return (
    <Select
      id={id}
      className={className}
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      {includeBlank !== null && <option value="">{includeBlank}</option>}
      {grouped.map(({ parent, children }) =>
        children.length === 0 ? (
          <option key={parent.id} value={parent.id}>
            {parent.name}
          </option>
        ) : (
          <optgroup key={parent.id} label={parent.name}>
            <option value={parent.id}>{parent.name} (all)</option>
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </Select>
  )
}

/** Display name for a category id, including its parent. */
export function categoryLabel(categories: Category[], categoryId: string | null): string {
  if (!categoryId) return 'Uncategorised'
  const category = categories.find((entry) => entry.id === categoryId)
  if (!category) return 'Unknown'
  if (!category.parent_id) return category.name
  const parent = categories.find((entry) => entry.id === category.parent_id)
  return parent ? `${parent.name} › ${category.name}` : category.name
}
