import { useId } from 'react'
import { d } from '../lib/money'

/**
 * Inline SVG sparkline. Deliberately not Recharts: these render one per table
 * row, and a charting library's per-instance cost is wasted on a 60×20 trend
 * with no axes or interaction.
 */
export function Sparkline({
  values,
  width = 72,
  height = 22,
  className,
  label,
}: {
  values: (string | number)[]
  width?: number
  height?: number
  className?: string
  label?: string
}) {
  const gradientId = useId()

  if (values.length === 0) {
    return <div style={{ width, height }} className={className} aria-hidden="true" />
  }

  const numbers = values.map((v) => d(v).toNumber())

  if (numbers.length === 1) {
    // A single point has no trend; draw a flat mark rather than nothing, so
    // the column does not look broken.
    return (
      <svg width={width} height={height} className={className} role="img" aria-label={label ?? 'One data point'}>
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 2"
          opacity={0.4}
        />
      </svg>
    )
  }

  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const span = max - min
  const pad = 2

  const x = (i: number) => pad + (i / (numbers.length - 1)) * (width - pad * 2)
  // A flat series has no meaningful scale; centre it instead of dividing by 0.
  const y = (v: number) =>
    span === 0 ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2)

  const points = numbers.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`)
  const linePath = `M${points.join(' L')}`
  const areaPath = `${linePath} L${x(numbers.length - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z`

  const first = numbers[0]!
  const last = numbers[numbers.length - 1]!
  const rising = last >= first
  const stroke = rising ? 'var(--color-positive)' : 'var(--color-negative)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label ?? `Trend, ${rising ? 'up' : 'down'} over ${numbers.length} points`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(numbers.length - 1)} cy={y(last)} r="1.75" fill={stroke} />
    </svg>
  )
}
