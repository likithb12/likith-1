import { Link } from 'react-router-dom'
import { EmptyState } from '../ui/feedback'
import { Card } from '../ui/primitives'

export function NotFound() {
  return (
    <Card>
      <EmptyState
        title="Page not found"
        description="That route does not exist."
        action={
          <Link to="/" className="text-sm font-medium text-brand underline underline-offset-2">
            Back to the dashboard
          </Link>
        }
      />
    </Card>
  )
}
