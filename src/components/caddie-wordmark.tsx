import { cn } from 'cn'

/**
 * The wordmark is the brand. Do not add a decorative app icon beside it.
 */
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
