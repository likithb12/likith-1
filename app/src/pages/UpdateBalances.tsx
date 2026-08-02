import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function UpdateBalances() {
  return (
    <div className="space-y-5">
      <PageHeader title="Update balances" subtitle="Record a new balance for every account in one pass." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 1."
        />
      </Card>
    </div>
  )
}
