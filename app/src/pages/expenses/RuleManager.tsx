import { useState } from 'react'
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '../../ui/primitives'
import { EmptyState, SkeletonRows } from '../../ui/feedback'
import { Icon } from '../../ui/Icon'
import { useToast } from '../../ui/toast'
import { CategorySelect, categoryLabel } from './CategorySelect'
import { useCategories } from '../../data/categories'
import {
  useApplyRulesRetroactively,
  useCategorisationRules,
  useDeleteRule,
  useSaveRule,
} from '../../data/imports'
import { isValidPattern } from '../../lib/rules'
import { describeError } from '../../lib/supabase'
import type { MatchType } from '../../types'

export function RuleManager() {
  const rules = useCategorisationRules()
  const categories = useCategories()
  const saveRule = useSaveRule()
  const deleteRule = useDeleteRule()
  const applyRetroactively = useApplyRulesRetroactively()
  const { notify } = useToast()

  const [pattern, setPattern] = useState('')
  const [matchType, setMatchType] = useState<MatchType>('contains')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [priority, setPriority] = useState(100)
  const [error, setError] = useState<string | null>(null)

  const allCategories = categories.data ?? []
  const allRules = rules.data ?? []

  async function add() {
    if (!isValidPattern(matchType, pattern)) {
      setError(
        matchType === 'regex'
          ? 'That is not a valid regular expression.'
          : 'Enter something to match on.',
      )
      return
    }
    if (!categoryId) {
      setError('Choose a category to assign.')
      return
    }

    try {
      await saveRule.mutateAsync({
        input: { match_type: matchType, pattern: pattern.trim(), category_id: categoryId, priority },
      })
      setPattern('')
      setError(null)
      notify('Rule added. It applies to future imports.', { tone: 'success' })
    } catch (caught) {
      notify(describeError(caught), { tone: 'error' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="New rule"
          subtitle="Rules run on import, lowest priority number first. The first match wins."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Match type">
            {(props) => (
              <Select
                {...props}
                value={matchType}
                onChange={(event) => setMatchType(event.target.value as MatchType)}
              >
                <option value="contains">Description contains</option>
                <option value="starts_with">Description starts with</option>
                <option value="regex">Regular expression</option>
              </Select>
            )}
          </Field>

          <Field label="Pattern" error={error} className="lg:col-span-2">
            {(props) => (
              <Input
                {...props}
                value={pattern}
                placeholder={matchType === 'regex' ? '^UBER\\s*(EATS)?' : 'woolworths'}
                onChange={(event) => {
                  setPattern(event.target.value)
                  setError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void add()
                }}
              />
            )}
          </Field>

          <Field label="Priority" hint="Lower runs first.">
            {(props) => (
              <Input
                {...props}
                type="number"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value) || 0)}
              />
            )}
          </Field>

          <Field label="Assign category" className="sm:col-span-2">
            {(props) => (
              <CategorySelect
                {...props}
                categories={allCategories}
                value={categoryId}
                includeBlank="Choose…"
                onChange={setCategoryId}
              />
            )}
          </Field>
        </div>

        <div className="flex justify-end border-t border-line px-4 py-3">
          <Button variant="primary" size="sm" loading={saveRule.isPending} onClick={() => void add()}>
            <Icon name="plus" />
            Add rule
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Rules"
          subtitle={`${allRules.length} rule${allRules.length === 1 ? '' : 's'}`}
          action={
            <Button
              size="sm"
              loading={applyRetroactively.isPending}
              disabled={allRules.length === 0}
              onClick={async () => {
                try {
                  const changed = await applyRetroactively.mutateAsync()
                  notify(
                    changed > 0
                      ? `Categorised ${changed} previously uncategorised transactions.`
                      : 'Nothing left to categorise.',
                    { tone: 'success' },
                  )
                } catch (error) {
                  notify(describeError(error), { tone: 'error' })
                }
              }}
            >
              Run over uncategorised
            </Button>
          }
        />

        {rules.isLoading ? (
          <SkeletonRows rows={3} />
        ) : allRules.length === 0 ? (
          <EmptyState
            title="No rules yet"
            description="A rule assigns a category automatically when a description matches. They apply as statements are imported, and can be re-run over anything still uncategorised."
          />
        ) : (
          <ul className="divide-y divide-line">
            {allRules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Badge tone="neutral">{rule.priority}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-content">
                    <span className="text-content-faint">{rule.match_type.replace('_', ' ')} </span>
                    <code className="rounded bg-surface px-1 py-0.5 text-xs">{rule.pattern}</code>
                  </p>
                  <p className="mt-0.5 text-xs text-content-muted">
                    → {categoryLabel(allCategories, rule.category_id)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete rule matching ${rule.pattern}`}
                  onClick={async () => {
                    try {
                      await deleteRule.mutateAsync(rule.id)
                      notify('Rule deleted.', { tone: 'success' })
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

        {allRules.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-content-faint">
            Re-running only fills in transactions that have no category. A category you set by hand is
            never overwritten.
          </p>
        )}
      </Card>
    </div>
  )
}
