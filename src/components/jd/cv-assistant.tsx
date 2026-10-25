import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Eyebrow, Notice } from '@/components/ui/section'
import { fileToBase64 } from '@/lib/docx'
import { planCvEdits } from '@/lib/plan'
import { cn } from 'cn'
import type { CvClassification } from '@shared/cv-classification'
import type { CvPlan } from '@shared/cv-plan'
import type { CvStory, FitGap, FitMessage } from '@shared/cv-fit'
import type { CompanyProfile, JdClassification } from '@shared/jd-classification'
import {
  AlertCircle,
  Check,
  LoaderCircle,
  Send,
  Sparkles,
  X,
} from 'lucide-react'

export type CvReadStatus = 'idle' | 'loading' | 'error' | 'ready'

type CvAssistantProps = {
  open: boolean
  onClose: () => void
  docx: File | null
  cv: CvClassification | null
  cvStatus: CvReadStatus
  cvError: string
  needsDeepRead: boolean
  onClassifyCv: () => void
  onDeepReadCv: () => void
  onApplyEdits: (edits: { blockId: string; text: string }[]) => Promise<void>
  onSaveStory: (story: CvStory) => void
  jd: JdClassification | null
  profile: CompanyProfile | null
  gaps: FitGap[]
  initialGap: FitGap | null
  stories: CvStory[]
}

function newStoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `story-${Date.now()}`
}

function relevantStories(stories: CvStory[], gaps: FitGap[]) {
  const terms = gaps
    .flatMap((gap) => [gap.label, ...gap.terms])
    .map((term) => term.toLowerCase())

  const scored = stories.map((story) => {
    const text = `${story.userText} ${story.bullet ?? ''} ${story.skills.join(' ')}`.toLowerCase()
    return {
      story,
      score: terms.reduce((total, term) => (text.includes(term) ? total + 1 : total), 0),
    }
  })

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map((entry) => entry.story)
}

export function CvAssistant({
  open,
  onClose,
  docx,
  cv,
  cvStatus,
  cvError,
  needsDeepRead,
  onClassifyCv,
  onDeepReadCv,
  onApplyEdits,
  onSaveStory,
  jd,
  profile,
  gaps,
  initialGap,
  stories,
}: CvAssistantProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<FitMessage[]>([])
  const [plan, setPlan] = useState<CvPlan | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'plan' | 'apply' | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])
  const [lastMessage, setLastMessage] = useState('')
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) requestRef.current?.abort()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(
    () => () => {
      requestRef.current?.abort()
    },
    [],
  )

  async function runPlan(text: string, nextExcluded: string[], appendUser: boolean) {
    if (!docx || !cv || !jd || busy) return

    const priorHistory = history
    const nextHistory = appendUser
      ? [...priorHistory, { role: 'user' as const, content: text }]
      : priorHistory

    if (appendUser) setHistory(nextHistory)
    setLastMessage(text)
    setMessage('')
    setPlan(null)
    setQuestion(null)
    setError('')
    setApplied(false)
    setBusy('plan')

    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    try {
      const response = await planCvEdits(
        {
          docx: await fileToBase64(docx),
          cv,
          jd,
          company: profile,
          gaps,
          message: text,
          history: priorHistory,
          stories: relevantStories(stories, gaps),
          excludeBlockIds: nextExcluded,
        },
        controller.signal,
      )
      if (controller.signal.aborted) return

      if (response.type === 'plan') {
        setPlan(response)
        setHistory([
          ...nextHistory,
          {
            role: 'assistant',
            content: `I found ${response.edits.length} safe ${response.edits.length === 1 ? 'edit' : 'edits'} that ${response.edits.length === 1 ? 'keeps' : 'keep'} the CV layout.`,
          },
        ])
      } else if (response.type === 'question') {
        setQuestion(response.question)
        setHistory([
          ...nextHistory,
          { role: 'assistant', content: response.question },
        ])
      } else {
        setError(response.reason)
      }
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(
        caught instanceof Error ? caught.message : 'The CV planner could not draft that.',
      )
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      setBusy(null)
    }
  }

  function send() {
    const text = message.trim()
    if (!text) return
    void runPlan(text, excluded, true)
  }

  function tryAnother() {
    if (!plan || !lastMessage) return
    const nextExcluded = [...excluded, ...plan.edits.map((edit) => edit.blockId)]
    setExcluded(nextExcluded)
    void runPlan(lastMessage, nextExcluded, false)
  }

  async function approve() {
    if (!plan || busy) return

    setBusy('apply')
    setError('')

    try {
      await onApplyEdits(
        plan.edits.map((edit) => ({ blockId: edit.blockId, text: edit.text })),
      )

      const now = new Date().toISOString()
      for (const edit of plan.edits) {
        const role = cv?.roles.find((entry) => entry.id === edit.roleId) ?? null
        const gap = gaps.find((entry) => edit.gapLabels.includes(entry.label))
        onSaveStory({
          id: newStoryId(),
          roleId: edit.roleId,
          projectId: edit.projectId,
          company: role?.company ?? null,
          title: role?.title ?? null,
          gapLabel: edit.gapLabels[0] ?? null,
          skills: gap?.terms.length ? gap.terms : edit.gapLabels,
          userText: lastMessage,
          bullet: edit.text,
          history: history.slice(-10),
          createdAt: now,
          updatedAt: now,
        })
      }

      setApplied(true)
      setPlan(null)
      setQuestion(null)
      setHistory((current) => [
        ...current,
        {
          role: 'assistant',
          content: `Updated ${plan.edits.length} ${plan.edits.length === 1 ? 'block' : 'blocks'} and kept the CV layout.`,
        },
      ])
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'That edit plan could not be applied.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  const canEdit = Boolean(docx)
  const canPlan = Boolean(docx && cv && jd)

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="CV assistant"
        className="drawer-shadow fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-border bg-card"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-brand-600">
              <Sparkles className="size-4" strokeWidth={1.75} />
              <Eyebrow>Tailor CV</Eyebrow>
            </div>
            <h2 className="mt-1.5 text-[15px] leading-none font-semibold tracking-[-0.015em] text-ink">
              Put your work where it matters
            </h2>
            <p className="mt-1.5 max-w-[40ch] text-[11.5px] leading-[1.45] text-muted-foreground">
              Show us the gaps, tell us what you have actually done, and Caddie will
              find the safest blocks to change without moving the page.
            </p>
          </div>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-ink max-sm:size-11"
            onClick={onClose}
            aria-label="Close CV assistant"
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {!canEdit ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
                <Sparkles className="size-5" strokeWidth={1.75} />
              </div>
              <p className="mt-3 text-[13px] font-medium text-ink">
                Upload a DOCX to edit your CV
              </p>
              <p className="mt-1 max-w-[34ch] text-[12px] leading-[1.5] text-muted-foreground">
                PDFs are read-only. A DOCX keeps the original fonts and lets
                Caddie replace anchored text without changing the layout.
              </p>
            </div>
          ) : cvStatus === 'idle' ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
                <Sparkles className="size-5" strokeWidth={1.75} />
              </div>
              <p className="mt-3 text-[13px] font-medium text-ink">Read your CV first</p>
              <p className="mt-1 max-w-[36ch] text-[12px] leading-[1.5] text-muted-foreground">
                Caddie needs your roles, projects and bullets to understand where a
                fact belongs and what is safe to change.
              </p>
              <Button className="mt-4 max-sm:h-11" onClick={onClassifyCv}>
                Read my CV
              </Button>
              <p className="mt-2 max-w-[34ch] text-[10.5px] leading-[1.4] text-muted-foreground">
                Sends the CV text to Cloudflare for extraction. It is not stored
                on the server.
              </p>
            </div>
          ) : cvStatus === 'loading' ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <LoaderCircle className="size-5 animate-spin text-brand-600" strokeWidth={1.75} />
              <p className="mt-3 text-[13px] font-medium text-ink">Reading your CV</p>
              <p className="mt-1 max-w-[34ch] text-[12px] leading-[1.5] text-muted-foreground">
                Mapping roles, projects and bullets. A deep read may take a minute or
                two.
              </p>
            </div>
          ) : cvStatus === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <AlertCircle className="size-5 text-muted-foreground" strokeWidth={1.75} />
              <p className="mt-3 text-[13px] font-medium text-ink">Could not read this CV</p>
              <p className="mt-1 max-w-[38ch] text-[12px] leading-[1.5] text-muted-foreground">
                {cvError}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="outline" className="max-sm:h-11" onClick={onClassifyCv}>
                  Try again
                </Button>
                <Button className="max-sm:h-11" onClick={onDeepReadCv}>
                  Deep read
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {applied ? (
                <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2.5 text-success">
                  <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <div>
                    <p className="text-[12px] font-medium">
                      Plan applied. The CV layout is unchanged.
                    </p>
                    <p className="mt-0.5 text-[11px] leading-[1.4] text-muted-foreground">
                      The facts are saved to your account for future postings.
                    </p>
                  </div>
                </div>
              ) : null}

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>Missing from your CV</Eyebrow>
                  {needsDeepRead ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-ink max-sm:h-11"
                      onClick={onDeepReadCv}
                    >
                      Deep read
                    </Button>
                  ) : null}
                </div>
                <p className="text-[11px] leading-[1.45] text-muted-foreground">
                  Tell us if you have worked with any of these. Mention the company or
                  project; Caddie will work out where it belongs.
                </p>
                {gaps.length === 0 ? (
                  <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11.5px] leading-[1.45] text-muted-foreground">
                    This CV already covers every must-have. You can still add work
                    worth showing.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {gaps.slice(0, 14).map((gap) => (
                      <span
                        key={`${gap.kind}-${gap.label}`}
                        className={cn(
                          'rounded-md border px-1.5 py-[1px] text-[10.5px] font-medium',
                          gap.kind === 'must'
                            ? 'border-mark-line/60 bg-mark/50 text-mark-foreground'
                            : 'border-related-line/70 bg-related/60 text-related-foreground',
                          initialGap?.label === gap.label ? 'ring-2 ring-brand-200' : '',
                        )}
                      >
                        {gap.label}
                      </span>
                    ))}
                    {gaps.length > 14 ? (
                      <span className="px-1.5 py-[1px] text-[10.5px] text-muted-foreground">
                        +{gaps.length - 14} more
                      </span>
                    ) : null}
                  </div>
                )}
              </section>

              {history.length > 0 ? (
                <section className="space-y-1.5">
                  <Eyebrow>Conversation</Eyebrow>
                  <div className="space-y-1.5">
                    {history.slice(-6).map((entry, index) => (
                      <p
                        key={`${entry.role}-${index}`}
                        className={cn(
                          'rounded-lg px-2.5 py-1.5 text-[11px] leading-[1.45]',
                          entry.role === 'user'
                            ? 'ml-6 bg-brand-50 text-ink'
                            : 'mr-3 bg-muted/60 text-muted-foreground',
                        )}
                      >
                        {entry.content}
                      </p>
                    ))}
                  </div>
                </section>
              ) : null}

              {question ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2.5 text-[11.5px] leading-[1.5] text-ink">
                  {question}
                </div>
              ) : null}

              {plan ? (
                <section className="space-y-3 rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Eyebrow>Proposed plan</Eyebrow>
                      <p className="mt-1 text-[11.5px] leading-[1.45] text-muted-foreground">
                        {plan.note}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] tabular-nums text-muted-foreground">
                      {plan.edits.length} {plan.edits.length === 1 ? 'edit' : 'edits'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {plan.edits.map((edit) => (
                      <div key={edit.blockId} className="rounded-lg border border-border/70 p-2.5">
                        <p className="text-[9.5px] font-medium text-muted-foreground">
                          {edit.targetLabel}
                        </p>
                        <p className="mt-1 text-[11px] leading-[1.45] text-muted-foreground line-through">
                          {edit.targetText}
                        </p>
                        <p className="mt-1.5 text-[12px] leading-[1.5] font-medium text-ink">
                          {edit.text}
                        </p>
                        {edit.gapLabels.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {edit.gapLabels.map((label) => (
                              <span
                                key={label}
                                className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9.5px] text-brand-700"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {edit.rationale ? (
                          <p className="mt-1.5 text-[10px] leading-[1.4] text-muted-foreground">
                            {edit.rationale}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums">
                      Lines {plan.lineCount.before} → {plan.lineCount.after}
                    </span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 tabular-nums">
                      Pages {plan.lineCount.pagesBefore} → {plan.lineCount.pagesAfter}
                    </span>
                    <span>{plan.protectedCount} protected {plan.protectedCount === 1 ? 'block' : 'blocks'}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      className="max-sm:h-11"
                      onClick={() => void approve()}
                      disabled={busy !== null}
                    >
                      {busy === 'apply' ? <LoaderCircle className="animate-spin" /> : null}
                      Apply plan
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-sm:h-11"
                      onClick={tryAnother}
                      disabled={busy !== null || !lastMessage}
                    >
                      Try another
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-ink max-sm:h-11"
                      onClick={() => setPlan(null)}
                      disabled={busy !== null}
                    >
                      Discard
                    </Button>
                  </div>
                </section>
              ) : null}

              {error ? <Notice>{error}</Notice> : null}
            </div>
          )}
        </div>

        {canEdit && cvStatus === 'ready' ? (
          <footer className="shrink-0 border-t border-border/70 bg-muted/20 px-4 py-3">
            <label
              htmlFor="cv-assistant-message"
              className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
            >
              What have you worked with?
            </label>
            <textarea
              id="cv-assistant-message"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 4_000))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              rows={6}
              placeholder={
                gaps[0]
                  ? `e.g. I worked with ${gaps[0].label.toLowerCase()} on Qartt at Anora.dev…`
                  : 'Tell us about work the CV does not show yet…'
              }
              disabled={!canPlan || busy !== null}
              className="mt-1.5 min-h-[132px] w-full resize-y rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] leading-[1.5] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="max-w-[34ch] text-[9.5px] leading-[1.4] text-muted-foreground">
                Only what you write is used. Mention projects and companies; Caddie
                will ask if it cannot place them.
              </p>
              <Button
                size="icon"
                className="size-10 shrink-0"
                onClick={send}
                disabled={!message.trim() || !canPlan || busy !== null}
                aria-label="Plan CV edits"
              >
                {busy === 'plan' ? <LoaderCircle className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </footer>
        ) : null}
      </div>
    </>
  )
}
