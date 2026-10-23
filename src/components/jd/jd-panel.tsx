import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from 'react'

import { CoverageRing } from '@/components/coverage-ring'
import {
  JdData,
  type ClassifyStatus,
  type ResearchStatus,
} from '@/components/jd/jd-data'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { classifyJd } from '@/lib/classify'
import { scoreRequirements } from '@/lib/match'
import { researchCompany } from '@/lib/research'
import type {
  ClassificationResult,
  ResearchResult,
  Signal,
} from '@shared/jd-classification'
import { cn } from 'cn'
import { AlertCircle, ClipboardPaste, LoaderCircle, X } from 'lucide-react'

type JdPanelProps = {
  value: string
  cvText: string
  onChange: (value: string) => void
  onLoadSample: () => string
}

const MAX_GAP_CHIPS = 4
const MAX_RELATED_CHIPS = 4

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

export function JdPanel({ value, cvText, onChange, onLoadSample }: JdPanelProps) {
  const [mode, setMode] = useState<'edit' | 'review' | 'data'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reviewRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const researchRequestRef = useRef<AbortController | null>(null)

  const [status, setStatus] = useState<ClassifyStatus>('idle')
  const [result, setResult] = useState<ClassificationResult | null>(null)
  const [error, setError] = useState('')

  const [profile, setProfile] = useState<ResearchResult | null>(null)
  const [researchStatus, setResearchStatus] = useState<ResearchStatus>('idle')
  const [researchError, setResearchError] = useState('')

  const hasText = value.trim().length > 0
  const words = hasText ? value.trim().split(/\s+/).length : 0
  const showEmptyState = !hasText
  const canReview = hasText

  const signals = useMemo(() => {
    const seen = new Set<string>()
    const list: Signal[] = []

    for (const signal of [
      ...(result?.data.signals ?? []),
      ...(profile?.profile.signals ?? []),
    ]) {
      const key = signal.label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push(signal)
    }

    return list
  }, [result, profile])

  // The score follows the classified posting, not a separate lexicon pass. The
  // CV side recomputes for free when the reader uploads a different CV.
  const score = useMemo(
    () =>
      result
        ? scoreRequirements(cvText, value, result.data.requirements, signals)
        : null,
    [cvText, value, result, signals],
  )

  // Leaving the panel must not leave a request running.
  useEffect(
    () => () => {
      requestRef.current?.abort()
      researchRequestRef.current?.abort()
      requestRef.current = null
      researchRequestRef.current = null
    },
    [],
  )

  function resetClassification() {
    requestRef.current?.abort()
    researchRequestRef.current?.abort()
    requestRef.current = null
    researchRequestRef.current = null
    setResult(null)
    setStatus('idle')
    setError('')
    setProfile(null)
    setResearchStatus('idle')
    setResearchError('')
  }

  function handleChange(next: string) {
    resetClassification()
    onChange(next)
    if (!next.trim()) setMode('edit')
  }

  async function runClassification(input: string = value) {
    const text = input.trim()
    if (text.length === 0) return

    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    // A new read replaces the old research too.
    researchRequestRef.current?.abort()
    researchRequestRef.current = null
    setProfile(null)
    setResearchStatus('idle')
    setResearchError('')

    setStatus('loading')
    setError('')

    try {
      const next = await classifyJd(text, controller.signal)
      if (controller.signal.aborted) return
      setResult(next)
      setStatus('ready')

      if (next.data.company.name) {
        void runResearch(
          next.data.company.name,
          next.data.role.title,
          next.data.role.fields,
          next.data.summary,
        )
      }
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

  async function runResearch(
    company: string,
    role: string,
    fields: string[],
    summary: string,
  ) {
    researchRequestRef.current?.abort()
    const controller = new AbortController()
    researchRequestRef.current = controller

    setResearchStatus('loading')
    setResearchError('')

    try {
      const next = await researchCompany(company, role, fields, summary, controller.signal)
      if (controller.signal.aborted) return
      setProfile(next)
      setResearchStatus('ready')
    } catch (caught) {
      if (controller.signal.aborted) return
      setResearchError(
        caught instanceof Error ? caught.message : 'Company research failed. Try again.',
      )
      setResearchStatus('error')
    } finally {
      if (researchRequestRef.current === controller) researchRequestRef.current = null
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
    // The score needs the classified posting, so a real paste starts the read.
    if (next.trim().length >= 40) void runClassification(next)
  }

  function openReview() {
    setMode('review')
    // the textarea unmounts, so keep keyboard focus in the panel
    requestAnimationFrame(() => reviewRef.current?.focus({ preventScroll: true }))
  }

  function handleLoadSample() {
    resetClassification()
    const text = onLoadSample()
    openReview()
    void runClassification(text)
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
        {score && score.coverage !== null ? <CoverageRing value={score.coverage} /> : null}
      </div>

      {hasText && status === 'loading' && mode !== 'data' ? (
        <div
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-2 border-y border-border/70 bg-muted/30 px-5 py-2.5 text-[11.5px] text-muted-foreground"
        >
          <LoaderCircle className="size-3.5 animate-spin text-brand-600" strokeWidth={2} />
          Reading the posting to score your CV…
        </div>
      ) : null}

      {hasText && status === 'error' && mode !== 'data' ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-y border-border/70 bg-muted/30 px-5 py-2.5">
          <span className="flex min-w-0 items-start gap-1.5 text-[11.5px] leading-[1.4] text-muted-foreground">
            <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
            <span className="min-w-0">{error}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 bg-card"
            onClick={() => void runClassification()}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {hasText && status === 'idle' && mode !== 'data' ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-y border-border/70 bg-muted/30 px-5 py-2.5">
          <span className="text-[11.5px] text-muted-foreground">
            Read the posting to score it against your CV.
          </span>
          <Button size="sm" onClick={() => void runClassification()}>
            Read with Gemma
          </Button>
        </div>
      ) : null}

      {hasText && score && score.coverage !== null ? (
        <div className="border-y border-border/70 bg-muted/30 px-5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11.5px] font-medium text-ink">
              {score.coverage}% covered
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {score.matched} of {score.total} must-haves
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={score.coverage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Job description coverage against your CV"
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-out"
              style={{ width: `${score.coverage}%` }}
            />
          </div>

          {score.gaps.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Missing from your CV
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {score.gaps.slice(0, MAX_GAP_CHIPS).map((gap) => (
                  <span
                    key={gap.key}
                    className="rounded-md border border-mark-line/60 bg-mark/50 px-1.5 py-[1px] text-[10.5px] font-medium text-mark-foreground"
                  >
                    {gap.term}
                  </span>
                ))}
                {score.gaps.length > MAX_GAP_CHIPS ? (
                  <span className="rounded-md px-1.5 py-[1px] text-[10.5px] text-muted-foreground">
                    +{score.gaps.length - MAX_GAP_CHIPS} more
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {score.related.length > 0 ? (
            <div className="mt-2.5">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Worth showing
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {score.related.slice(0, MAX_RELATED_CHIPS).map((item) => (
                  <span
                    key={item.key}
                    className="rounded-md border border-related-line/70 bg-related/60 px-1.5 py-[1px] text-[10.5px] font-medium text-related-foreground"
                  >
                    {item.term}
                  </span>
                ))}
                {score.related.length > MAX_RELATED_CHIPS ? (
                  <span className="rounded-md px-1.5 py-[1px] text-[10.5px] text-muted-foreground">
                    +{score.related.length - MAX_RELATED_CHIPS} more
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {researchStatus === 'loading' && result?.data.company.name ? (
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" strokeWidth={2} />
              Researching {result.data.company.name} for more relevant signals…
            </p>
          ) : null}
        </div>
      ) : null}

      {hasText && status === 'ready' && score && score.total === 0 ? (
        <p className="shrink-0 border-y border-border/70 bg-muted/30 px-5 py-2.5 text-[11.5px] text-muted-foreground">
          No must-have requirements were read from this posting.
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
              profile={profile}
              researchStatus={researchStatus}
              researchError={researchError}
              onRun={() => void runClassification()}
              onResearch={() => {
                if (result?.data.company.name) {
                  void runResearch(
                    result.data.company.name,
                    result.data.role.title,
                    result.data.role.fields,
                    result.data.summary,
                  )
                }
              }}
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
                  The posting, the requirements, all of it. Gemma reads it after
                  you paste, then marks what your CV is missing.
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
              {score
                ? score.pieces.map((piece, index) => {
                    if (piece.mark === 'gap') {
                      return (
                        <mark
                          key={index}
                          className="rounded-[3px] bg-mark px-[2px] text-mark-foreground shadow-[inset_0_-1px_0_var(--mark-line)]"
                        >
                          {piece.text}
                        </mark>
                      )
                    }

                    if (piece.mark === 'related') {
                      return (
                        <mark
                          key={index}
                          className="rounded-[3px] bg-related px-[2px] text-related-foreground shadow-[inset_0_-1px_0_var(--related-line)]"
                        >
                          {piece.text}
                        </mark>
                      )
                    }

                    return <span key={index}>{piece.text}</span>
                  })
                : value}
            </div>
          </div>
        )}
      </div>

      {mode === 'review' && hasText && score ? (
        <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/70 bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-mark ring-1 ring-mark-line" />
              Missing
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-related ring-1 ring-related-line" />
              Worth showing
            </span>
          </span>
          <span>Matching stays in your browser</span>
        </div>
      ) : null}
    </aside>
  )
}
