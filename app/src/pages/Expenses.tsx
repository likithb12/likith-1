import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function Expenses() {
  return (
    <div className="space-y-5">
      <PageHeader title="Expenses" subtitle="Transactions, categories and budgets." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 2."
        />
      </Card>
    </div>
  )
}
