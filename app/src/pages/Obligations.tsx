import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function Obligations() {
  return (
    <div className="space-y-5">
      <PageHeader title="Obligations" subtitle="What you owe and what you are owed." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 3."
        />
      </Card>
    </div>
  )
}
