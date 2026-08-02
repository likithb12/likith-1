import { useState } from 'react'
import { PageHeader, cx } from '../ui/primitives'
import { TransactionList } from './expenses/TransactionList'
import { ImportWizard } from './expenses/ImportWizard'
import { BudgetManager } from './expenses/BudgetManager'
import { CategoryManager } from './expenses/CategoryManager'
import { RuleManager } from './expenses/RuleManager'

const TABS = [
  { id: 'transactions', label: 'Transactions' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'import', label: 'Import' },
  { id: 'categories', label: 'Categories' },
  { id: 'rules', label: 'Rules' },
] as const

type TabId = (typeof TABS)[number]['id']

export function Expenses() {
  const [tab, setTab] = useState<TabId>('transactions')

  return (
    <div className="space-y-5">
      <PageHeader title="Expenses" subtitle="Where the money went, and whether that was the plan." />

      <div className="overflow-x-auto">
        <div role="tablist" aria-label="Expenses sections" className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              type="button"
              id={`tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`panel-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={cx(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === entry.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-content-muted hover:text-content',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'transactions' && <TransactionList />}
        {tab === 'budgets' && <BudgetManager />}
        {tab === 'import' && <ImportWizard />}
        {tab === 'categories' && <CategoryManager />}
        {tab === 'rules' && <RuleManager />}
      </div>
    </div>
  )
}
