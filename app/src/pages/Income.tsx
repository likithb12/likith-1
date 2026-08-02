import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function Income() {
  return (
    <div className="space-y-5">
      <PageHeader title="Income" subtitle="Income sources, events and savings rate." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 4."
        />
      </Card>
    </div>
  )
}
