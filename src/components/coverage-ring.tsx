import { cn } from 'cn'

type CoverageRingProps = {
  /** 0–100, or null when there is nothing to analyse */
  value: number | null
  className?: string
}

const SIZE = 46
const STROKE = 4.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function CoverageRing({ value, className }: CoverageRingProps) {
  const progress = value === null ? 0 : Math.max(0, Math.min(100, value))
  const offset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={
        value === null ? 'No coverage yet' : `${value}% of the job description is covered`
      }
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#e6ecf7"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--brand-600)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11.5px] font-semibold tabular-nums tracking-tight text-ink">
        {value === null ? '—' : `${value}%`}
      </span>
    </div>
  )
}
