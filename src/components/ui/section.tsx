import type { ReactNode } from 'react'

import { cn } from 'cn'
import { AlertCircle, Check } from 'lucide-react'

/** Small caps section label. One voice for every card header. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </p>
  )
}

type NoticeTone = 'info' | 'success'

/**
 * Inline banner for form-level feedback. Errors and plain information share
 * the quiet tone; only confirmed good news uses green.
 */
export function Notice({
  tone = 'info',
  role,
  className,
  children,
}: {
  tone?: NoticeTone
  role?: 'alert' | 'status'
  className?: string
  children: ReactNode
}) {
  const success = tone === 'success'
  return (
    <p
      role={role ?? (success ? 'status' : 'alert')}
      className={cn(
        'flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[11px] leading-[1.45]',
        success
          ? 'border-success/20 bg-success/5 text-success'
          : 'border-border/70 bg-muted/30 text-muted-foreground',
        className,
      )}
    >
      {success ? (
        <Check className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      ) : (
        <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  )
}
