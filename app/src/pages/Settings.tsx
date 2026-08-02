import { PageHeader, Card } from '../ui/primitives'
import { EmptyState } from '../ui/feedback'

export function Settings() {
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Currencies, adapters, export and import." />
      <Card>
        <EmptyState
          title="Not built yet"
          description="This screen arrives in phase 1."
        />
      </Card>
    </div>
  )
}
