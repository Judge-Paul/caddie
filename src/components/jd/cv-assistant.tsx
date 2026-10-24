import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { fileToBase64 } from '@/lib/docx'
import { proposeCvFit } from '@/lib/fit'
import { cn } from 'cn'
import type { CvClassification } from '@shared/cv-classification'
import type {
  CvStory,
  FitGap,
  FitMessage,
  FitProposal,
  FitRequest,
} from '@shared/cv-fit'
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
  onClassifyCv: () => void
  onApplyEdit: (blockId: string, text: string) => Promise<void>
  onSaveStory: (story: CvStory) => void
  jd: JdClassification | null
  profile: CompanyProfile | null
  gaps: FitGap[]
  initialGap: FitGap | null
  stories: CvStory[]
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </p>
  )
}

function newStoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `story-${Date.now()}`
}

export function CvAssistant({
  open,
  onClose,
  docx,
  cv,
  cvStatus,
  cvError,
  onClassifyCv,
  onApplyEdit,
  onSaveStory,
  jd,
  profile,
  gaps,
  initialGap,
  stories,
}: CvAssistantProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  const [gap, setGap] = useState<FitGap | null>(null)
  const [roleId, setRoleId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<FitMessage[]>([])
  const [proposal, setProposal] = useState<FitProposal | null>(null)
  const [question, setQuestion] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'fit' | 'apply' | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])
  const [lastMessage, setLastMessage] = useState('')
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (!open) return

    setGap(initialGap ?? gaps[0] ?? null)
    setProposal(null)
    setQuestion(null)
    setError('')
    setHistory([])
    setExcluded([])
    setApplied(false)
    closeRef.current?.focus()
    // Only when the drawer opens or a gap chip targets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialGap])

  useEffect(() => {
    if (!cv) {
      setRoleId(null)
      return
    }
    if (!cv.roles.some((role) => role.id === roleId)) {
      setRoleId(cv.roles[0]?.id ?? null)
    }
  }, [cv, roleId])

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

  function resetConversation() {
    setProposal(null)
    setQuestion(null)
    setError('')
    setHistory([])
    setExcluded([])
    setApplied(false)
    setLastMessage('')
  }

  function chooseGap(next: FitGap) {
    setGap(next)
    resetConversation()
  }

  function chooseRole(next: string) {
    setRoleId(next)
    resetConversation()
  }

  function relevantStories() {
    if (!gap) return []
    return stories
      .filter(
        (story) =>
          story.roleId === roleId ||
          story.gapLabel === gap.label ||
          story.skills.some((skill) =>
            gap.terms.some((term) => term.toLowerCase() === skill.toLowerCase()),
          ),
      )
      .slice(0, 8)
  }

  async function runFit(
    text: string,
    nextExcluded: string[],
    appendUser: boolean,
  ) {
    if (!docx || !cv || !jd || !gap || !roleId || busy) return

    const priorHistory = history
    const nextHistory = appendUser
      ? [...priorHistory, { role: 'user' as const, content: text }]
      : priorHistory

    if (appendUser) setHistory(nextHistory)
    setLastMessage(text)
    setMessage('')
    setProposal(null)
    setQuestion(null)
    setError('')
    setApplied(false)
    setBusy('fit')

    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    try {
      const input: FitRequest = {
        docx: await fileToBase64(docx),
        cv,
        jd,
        company: profile,
        gap,
        roleId,
        message: text,
        history: priorHistory,
        stories: relevantStories(),
        excludeBlockIds: nextExcluded,
      }

      const response = await proposeCvFit(input, controller.signal)
      if (controller.signal.aborted) return

      if (response.type === 'proposal') {
        setProposal(response)
        setHistory([
          ...nextHistory,
          {
            role: 'assistant',
            content: `I drafted a bullet that keeps the CV at ${response.lineCount.before} lines: “${response.bullet}”`,
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
        caught instanceof Error
          ? caught.message
          : 'The CV assistant could not draft that.',
      )
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      setBusy(null)
    }
  }

  function send() {
    const text = message.trim()
    if (!text) return
    void runFit(text, excluded, true)
  }

  function tryAnother() {
    if (!proposal || !lastMessage) return
    const nextExcluded = [...excluded, proposal.target.blockId]
    setExcluded(nextExcluded)
    void runFit(lastMessage, nextExcluded, false)
  }

  async function approve() {
    if (!proposal || !gap || busy) return

    setBusy('apply')
    setError('')

    try {
      await onApplyEdit(proposal.target.blockId, proposal.bullet)

      const now = new Date().toISOString()
      const statement = `${lastMessage} ${proposal.bullet}`.toLowerCase()
      const confirmedSkills = gap.terms.filter((term) =>
        statement.includes(term.toLowerCase()),
      )

      onSaveStory({
        id: newStoryId(),
        roleId: proposal.role.id,
        company: proposal.role.company,
        title: proposal.role.title,
        gapLabel: proposal.gapLabel,
        skills: confirmedSkills.length > 0 ? confirmedSkills : [gap.label],
        userText: lastMessage,
        bullet: proposal.bullet,
        history: history.slice(-10),
        createdAt: now,
        updatedAt: now,
      })

      setApplied(true)
      setProposal(null)
      setQuestion(null)
      setHistory((current) => [
        ...current,
        {
          role: 'assistant',
          content:
            'Updated your CV and stored this fact in your profile for future postings.',
        },
      ])
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'That bullet could not be applied.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  const canEdit = Boolean(docx)
  const roles = cv?.roles ?? []

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="CV assistant"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[430px] flex-col border-l border-border bg-card shadow-[-24px_0_60px_-40px_rgba(13,21,38,0.45)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-brand-600">
              <Sparkles className="size-4" strokeWidth={1.75} />
              <Eyebrow>CV assistant</Eyebrow>
            </div>
            <h2 className="mt-1.5 text-[15px] leading-none font-semibold tracking-[-0.015em] text-ink">
              Close a gap with your own work
            </h2>
            <p className="mt-1.5 max-w-[38ch] text-[11.5px] leading-[1.45] text-muted-foreground">
              Tell Caddie what you did. It drafts one bullet, replaces the least
              relevant one, and keeps the same line count.
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                Caddie replace a bullet without changing the layout.
              </p>
            </div>
          ) : cvStatus === 'idle' ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
                <Sparkles className="size-5" strokeWidth={1.75} />
              </div>
              <p className="mt-3 text-[13px] font-medium text-ink">
                Read your CV first
              </p>
              <p className="mt-1 max-w-[34ch] text-[12px] leading-[1.5] text-muted-foreground">
                Caddie needs your roles and bullets to know where a fact belongs
                and which bullet is safe to replace.
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
              <LoaderCircle
                className="size-5 animate-spin text-brand-600"
                strokeWidth={1.75}
              />
              <p className="mt-3 text-[13px] font-medium text-ink">
                Reading your CV
              </p>
              <p className="mt-1 max-w-[34ch] text-[12px] leading-[1.5] text-muted-foreground">
                Mapping roles, bullets and anchors. This can take up to a minute.
              </p>
            </div>
          ) : cvStatus === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <AlertCircle
                className="size-5 text-muted-foreground"
                strokeWidth={1.75}
              />
              <p className="mt-3 text-[13px] font-medium text-ink">
                Could not read this CV
              </p>
              <p className="mt-1 max-w-[38ch] text-[12px] leading-[1.5] text-muted-foreground">
                {cvError}
              </p>
              <Button variant="outline" className="mt-4 max-sm:h-11" onClick={onClassifyCv}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {applied ? (
                <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2.5 text-success">
                  <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <div>
                    <p className="text-[12px] font-medium">
                      Bullet replaced. The line count is unchanged.
                    </p>
                    <p className="mt-0.5 text-[11px] leading-[1.4] text-muted-foreground">
                      The fact is saved to your local profile for future postings.
                    </p>
                  </div>
                </div>
              ) : null}

              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>Gap to close</Eyebrow>
                  {gap ? (
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[9.5px] font-medium',
                        gap.kind === 'must'
                          ? 'bg-mark/50 text-mark-foreground'
                          : 'bg-related/60 text-related-foreground',
                      )}
                    >
                      {gap.kind === 'must' ? 'Must have' : 'Worth showing'}
                    </span>
                  ) : null}
                </div>
                {gaps.length === 0 ? (
                  <p className="text-[11.5px] leading-[1.5] text-muted-foreground">
                    This CV already covers every must-have in the posting.
                  </p>
                ) : (
                  <select
                    value={gap?.label ?? ''}
                    onChange={(event) => {
                      const next = gaps.find(
                        (entry) => entry.label === event.target.value,
                      )
                      if (next) chooseGap(next)
                    }}
                    aria-label="Gap to close"
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12px] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:h-11"
                  >
                    {gaps.map((entry) => (
                      <option key={`${entry.kind}-${entry.label}`} value={entry.label}>
                        {entry.label} — {entry.kind === 'must' ? 'must have' : 'worth showing'}
                      </option>
                    ))}
                  </select>
                )}
              </section>

              <section className="space-y-1.5">
                <Eyebrow>Where did you do it?</Eyebrow>
                {roles.length === 0 ? (
                  <p className="text-[11.5px] text-muted-foreground">
                    No roles were found in this CV.
                  </p>
                ) : (
                  <select
                    value={roleId ?? ''}
                    onChange={(event) => chooseRole(event.target.value)}
                    aria-label="Role where you did this"
                    className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12px] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:h-11"
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {[role.title, role.company, role.dates]
                          .filter(Boolean)
                          .join(' · ')}
                      </option>
                    ))}
                  </select>
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

              {proposal ? (
                <section className="space-y-2.5 rounded-xl border border-border bg-card p-3">
                  <div>
                    <Eyebrow>Replace this bullet</Eyebrow>
                    <p className="mt-1 text-[11.5px] leading-[1.45] text-muted-foreground line-through">
                      {proposal.target.text}
                    </p>
                  </div>
                  <div>
                    <Eyebrow>With</Eyebrow>
                    <p className="mt-1 text-[12px] leading-[1.5] font-medium text-ink">
                      {proposal.bullet}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 tabular-nums">
                      Lines {proposal.lineCount.before} → {proposal.lineCount.after}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 tabular-nums">
                      Pages {proposal.lineCount.pagesBefore} → {proposal.lineCount.pagesAfter}
                    </span>
                  </div>
                  {proposal.rationale ? (
                    <p className="text-[10.5px] leading-[1.45] text-muted-foreground">
                      {proposal.rationale}
                    </p>
                  ) : null}
                  {proposal.factsUsed.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {proposal.factsUsed.map((fact) => (
                        <span
                          key={fact}
                          className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[9.5px] text-brand-700"
                        >
                          {fact}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      className="max-sm:h-11"
                      onClick={() => void approve()}
                      disabled={busy !== null}
                    >
                      {busy === 'apply' ? (
                        <LoaderCircle className="animate-spin" />
                      ) : null}
                      Replace bullet
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
                      onClick={() => setProposal(null)}
                      disabled={busy !== null}
                    >
                      Discard
                    </Button>
                  </div>
                </section>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-[11px] leading-[1.45] text-muted-foreground"
                >
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {canEdit && cvStatus === 'ready' ? (
          <footer className="shrink-0 border-t border-border/70 bg-muted/20 px-4 py-3">
            <label
              htmlFor="cv-assistant-message"
              className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
            >
              What did you do?
            </label>
            <div className="mt-1.5 flex items-end gap-1.5">
              <textarea
                id="cv-assistant-message"
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    send()
                  }
                }}
                rows={2}
                placeholder={
                  gap && roleId
                    ? `e.g. I built and scaled ${gap.label.toLowerCase()} at that role…`
                    : 'Pick a gap and a role first.'
                }
                disabled={!gap || !roleId || busy !== null}
                className="min-h-[58px] w-full resize-none rounded-lg border border-border bg-card px-2.5 py-2 text-[12px] leading-[1.45] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
              <Button
                size="icon"
                className="size-10 shrink-0"
                onClick={send}
                disabled={!message.trim() || !gap || !roleId || busy !== null}
                aria-label="Send to CV assistant"
              >
                {busy === 'fit' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Send />
                )}
              </Button>
            </div>
            <p className="mt-1.5 text-[9.5px] leading-[1.4] text-muted-foreground">
              Only what you write is used. Nothing is invented. Facts are stored
              in your browser profile.
            </p>
          </footer>
        ) : null}
      </div>
    </>
  )
}
