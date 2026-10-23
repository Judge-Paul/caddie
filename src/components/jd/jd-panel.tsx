import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'

import { CoverageRing } from '@/components/coverage-ring'
import { JdData, type ClassifyStatus } from '@/components/jd/jd-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Analysis } from '@/lib/analyze'
import { classifyJd } from '@/lib/classify'
import type { ClassificationResult } from '@shared/jd-classification'
import { cn } from 'cn'
import { ClipboardPaste, X } from 'lucide-react'

type JdPanelProps = {
  value: string
  analysis: Analysis
  onChange: (value: string) => void
  onLoadSample: () => void
}

const MAX_GAP_CHIPS = 4

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        active
          ? 'bg-card text-ink shadow-[0_1px_2px_rgba(13,21,38,0.08)]'
          : 'text-muted-foreground hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function JdPanel({ value, analysis, onChange, onLoadSample }: JdPanelProps) {
  const [mode, setMode] = useState<'edit' | 'review' | 'data'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  const [status, setStatus] = useState<ClassifyStatus>('idle')
  const [result, setResult] = useState<ClassificationResult | null>(null)
  const [error, setError] = useState('')

  const hasText = value.trim().length > 0
  const words = hasText ? value.trim().split(/\s+/).length : 0
  const showEmptyState = !hasText
  const canReview = hasText

  // Leaving the panel must not leave a request running.
  useEffect(
    () => () => {
      requestRef.current?.abort()
      requestRef.current = null
    },
    [],
  )

  function resetClassification() {
    requestRef.current?.abort()
    requestRef.current = null
    setResult(null)
    setStatus('idle')
    setError('')
  }

  function handleChange(next: string) {
    resetClassification()
    onChange(next)
    if (!next.trim()) setMode('edit')
  }

  async function runClassification() {
    const text = value.trim()
    if (text.length === 0) return

    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    setStatus('loading')
    setError('')

    try {
      const next = await classifyJd(text, controller.signal)
      if (controller.signal.aborted) return
      setResult(next)
      setStatus('ready')
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(
        caught instanceof Error
          ? caught.message
          : 'The posting could not be classified. Try again.',
      )
      setStatus('error')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData('text')
    if (!pasted) return

    event.preventDefault()
    const next =
      value.slice(0, event.currentTarget.selectionStart) +
      pasted +
      value.slice(event.currentTarget.selectionEnd)

    handleChange(next)
    openReview()
  }

  function openReview() {
    setMode('review')
    // the textarea unmounts, so keep keyboard focus in the panel
    requestAnimationFrame(() => reviewRef.current?.focus({ preventScroll: true }))
  }

  function handleLoadSample() {
    resetClassification()
    onLoadSample()
    openReview()
  }

  function handleClear() {
    resetClassification()
    onChange('')
    setMode('edit')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(13,21,38,0.04),0_12px_32px_-24px_rgba(13,21,38,0.25)] lg:h-full">
      <div className="flex items-start justify-between gap-4 px-5 pt-4.5 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] leading-none font-semibold tracking-[-0.015em] text-ink">
              Job description
            </h2>
            {hasText ? (
              <Badge
                variant="secondary"
                className="h-[18px] px-1.5 text-[10.5px] font-medium text-muted-foreground"
              >
                {words} words
              </Badge>
            ) : null}
          </div>
          <p className="mt-1.5 max-w-[42ch] text-[12px] leading-[1.45] text-muted-foreground">
            {hasText
              ? 'Red marks what your CV does not cover.'
              : "Paste the posting and we'll mark what your CV doesn't cover."}
          </p>
        </div>
        {analysis.coverage === null ? null : (
          <CoverageRing value={analysis.coverage} />
        )}
      </div>

      {hasText && analysis.coverage !== null ? (
        <div className="border-y border-border/70 bg-muted/30 px-5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11.5px] font-medium text-ink">
              {analysis.coverage}% covered
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {analysis.matched} of {analysis.total} requirements
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={analysis.coverage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Job description coverage"
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-out"
              style={{ width: `${analysis.coverage}%` }}
            />
          </div>

          {analysis.gaps.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Missing from your CV
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {analysis.gaps.slice(0, MAX_GAP_CHIPS).map((gap) => (
                  <span
                    key={gap.term}
                    className="rounded-md border border-mark-line/60 bg-mark/50 px-1.5 py-[1px] text-[10.5px] font-medium text-mark-foreground"
                  >
                    {gap.term}
                  </span>
                ))}
                {analysis.gaps.length > MAX_GAP_CHIPS ? (
                  <span className="rounded-md px-1.5 py-[1px] text-[10.5px] text-muted-foreground">
                    +{analysis.gaps.length - MAX_GAP_CHIPS} more
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasText && analysis.total === 0 ? (
        <p className="shrink-0 border-y border-border/70 bg-muted/30 px-5 py-2.5 text-[11.5px] text-muted-foreground">
          No requirements detected. Try pasting the full posting.
        </p>
      ) : null}

      {hasText ? (
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <ModeButton active={mode === 'edit'} onClick={() => setMode('edit')}>
              Paste
            </ModeButton>
            <ModeButton active={mode === 'review'} onClick={() => setMode('review')}>
              Review
            </ModeButton>
            <ModeButton active={mode === 'data'} onClick={() => setMode('data')}>
              Data
            </ModeButton>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-ink"
              onClick={handleLoadSample}
            >
              Sample
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-ink"
              onClick={handleClear}
              aria-label="Clear job description"
            >
              <X />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="relative min-h-[300px] flex-1 lg:min-h-0">
        {mode === 'data' && canReview ? (
          <div className="h-full overflow-y-auto px-5 py-4">
            <JdData
              status={status}
              result={result}
              error={error}
              onRun={() => void runClassification()}
            />
          </div>
        ) : mode === 'edit' || !canReview ? (
          <div className="relative h-full">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => handleChange(event.target.value)}
              onPaste={handlePaste}
              aria-label="Job description"
              placeholder=""
              spellCheck={false}
              className="h-full min-h-[300px] resize-none rounded-none border-0 bg-transparent px-5 py-4 text-[13px] leading-[1.7] text-[#2a3446] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 [field-sizing:fixed] dark:bg-transparent"
            />

            {showEmptyState ? (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
                  <ClipboardPaste className="size-5" strokeWidth={1.75} />
                </div>
                <p className="mt-3 text-[13px] font-medium text-ink">
                  Paste the job description
                </p>
                <p className="mt-1 max-w-[36ch] text-[12px] leading-[1.5] text-muted-foreground">
                  The posting, the requirements, all of it. Coverage updates the
                  moment you paste.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-events-auto mt-4 bg-card"
                  onClick={handleLoadSample}
                >
                  Try a sample role
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            ref={reviewRef}
            tabIndex={-1}
            role="region"
            aria-label="Job description with coverage highlights"
            className="h-full overflow-y-auto px-5 py-4 outline-none"
          >
            <div className="whitespace-pre-wrap text-[13px] leading-[1.7] text-[#2a3446]">
              {analysis.pieces.map((piece, index) =>
                piece.mark ? (
                  <mark
                    key={index}
                    className="rounded-[3px] bg-mark px-[2px] text-mark-foreground shadow-[inset_0_-1px_0_var(--mark-line)]"
                  >
                    {piece.text}
                  </mark>
                ) : (
                  <span key={index}>{piece.text}</span>
                ),
              )}
            </div>
          </div>
        )}
      </div>

      {mode === 'review' && hasText ? (
        <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-5 py-2.5">
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="size-2.5 rounded-[2px] bg-mark ring-1 ring-mark-line" />
            Not found in your CV
          </span>
          <span className="text-[11px] text-muted-foreground">
            Coverage runs in your browser
          </span>
        </div>
      ) : null}
    </aside>
  )
}
