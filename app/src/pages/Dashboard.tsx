import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function Dashboard() {
  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" subtitle="Net worth, trends and this month at a glance." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 1."
        />
      </Card>
    </div>
  )
}
