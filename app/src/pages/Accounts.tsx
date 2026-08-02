import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function Accounts() {
  return (
    <div className="space-y-5">
      <PageHeader title="Accounts" subtitle="Asset and liability accounts." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 1."
        />
      </Card>
    </div>
  )
}
