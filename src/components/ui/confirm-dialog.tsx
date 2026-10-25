import { useEffect, useRef, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { LoaderCircle, X } from 'lucide-react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  destructive?: boolean
  children?: ReactNode
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  destructive = false,
  children,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]"
        onClick={() => {
          if (!busy) onClose()
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="dialog-shadow pointer-events-auto w-full max-w-[430px] overflow-hidden rounded-xl border border-border bg-card"
        >
          <header className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <h2 className="text-[15px] leading-none font-semibold tracking-[-0.015em] text-ink">
                {title}
              </h2>
              <p className="mt-2 text-[12px] leading-[1.5] text-muted-foreground">
                {description}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-ink"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              <X />
            </Button>
          </header>

          {children ? (
            <div className="mx-5 mt-4 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              {children}
            </div>
          ) : null}

          <footer className="mt-5 flex justify-end gap-2 border-t border-border/70 bg-muted/20 px-5 py-3">
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              className="max-sm:h-11"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </footer>
        </div>
      </div>
    </>
  )
}
