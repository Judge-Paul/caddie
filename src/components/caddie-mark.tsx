import { cn } from 'cn'

type MarkProps = {
  className?: string
  /** unique gradient id so multiple marks can render on one page */
  id?: string
}

/**
 * Caddie mark: a pin flag in a blue squircle. The caddie reads the course;
 * the flag is the role you are aiming at.
 */
export function CaddieMark({ className, id = 'caddie-mark' }: MarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient
          id={id}
          x1="5"
          y1="1"
          x2="27"
          y2="31"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4A73FF" />
          <stop offset="0.55" stopColor="#2347E6" />
          <stop offset="1" stopColor="#1730B4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <rect
        width="32"
        height="32"
        rx="9"
        fill="none"
        stroke="white"
        strokeOpacity="0.16"
      />
      <path
        d="M11.6 8.8v14.4"
        stroke="white"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path d="M12.9 9.4 21.7 12.6 12.9 15.8Z" fill="white" />
      <ellipse cx="18.9" cy="24.2" rx="4.4" ry="1.45" fill="white" fillOpacity="0.5" />
    </svg>
  )
}

export function CaddieWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'text-[17px] leading-none font-semibold tracking-[-0.03em] text-ink',
        className,
      )}
    >
      Caddie
    </span>
  )
}
