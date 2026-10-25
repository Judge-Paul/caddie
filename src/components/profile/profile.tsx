import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'
import { PublicWork } from '@/components/profile/public-work'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Eyebrow, Notice } from '@/components/ui/section'
import { Input } from '@/components/ui/input'
import {
  deleteSending,
  deleteStory,
  saveSending,
  saveStory,
  testSending,
  unlinkTelegram,
} from '@/lib/account'
import type { AccountMe } from '@shared/account'
import type { CvStory } from '@shared/cv-fit'
import {
  AlertCircle,
  ExternalLink,
  FileText,
  KeyRound,
  LoaderCircle,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Unplug,
  Upload,
  X,
} from 'lucide-react'

type ProfileProps = {
  me: AccountMe
  onUploadCv: (file: File) => Promise<void>
  onRefreshMe: () => Promise<void>
}

const dateFormat = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

function newStoryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `story-${Date.now()}`
}

function parseSkills(value: string) {
  const seen = new Set<string>()
  return value
    .split(',')
    .map((skill) => skill.trim().slice(0, 40))
    .filter((skill) => {
      const key = skill.toLowerCase()
      if (!skill || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

function ExperienceDialog({
  story,
  open,
  onClose,
  onSaved,
}: {
  story: CvStory | null
  open: boolean
  onClose: () => void
  onSaved: (story: CvStory) => Promise<void>
}) {
  const [title, setTitle] = useState(story?.title ?? '')
  const [company, setCompany] = useState(story?.company ?? '')
  const [userText, setUserText] = useState(story?.userText ?? '')
  const [skills, setSkills] = useState(story?.skills.join(', ') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => textRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  async function handleSave() {
    const text = userText.trim()
    if (text.length < 20) {
      setError('Write at least a sentence about what you did.')
      return
    }

    setBusy(true)
    setError('')
    const now = new Date().toISOString()
    const next: CvStory = {
      id: story?.id ?? newStoryId(),
      roleId: story?.roleId ?? null,
      projectId: story?.projectId ?? null,
      company: company.trim() || null,
      title: title.trim() || null,
      gapLabel: story?.gapLabel ?? null,
      skills: parseSkills(skills),
      userText: text,
      bullet: story?.bullet ?? null,
      ...(story?.history ? { history: story.history } : {}),
      createdAt: story?.createdAt ?? now,
      updatedAt: now,
    }

    try {
      await onSaved(next)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That experience could not be saved.')
    } finally {
      setBusy(false)
    }
  }

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
          aria-label={story ? 'Edit experience' : 'Add experience'}
          className="dialog-shadow pointer-events-auto flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-card"
        >
          <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
            <div>
              <Eyebrow>{story ? 'Edit experience' : 'Add experience'}</Eyebrow>
              <h2 className="mt-1 text-[16px] leading-none font-semibold tracking-[-0.015em] text-ink">
                What did you work on?
              </h2>
              <p className="mt-1.5 max-w-[44ch] text-[11.5px] leading-[1.45] text-muted-foreground">
                Write it in your own words. Caddie uses it to ground CV bullets,
                letters and email drafts.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-ink max-sm:size-11"
              onClick={onClose}
              disabled={busy}
              aria-label="Close experience"
            >
              <X />
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                  Role or project
                </span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Senior Frontend Engineer"
                  className="mt-1.5"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                  Company
                </span>
                <Input
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="Northwind Labs"
                  className="mt-1.5"
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                What you did
              </span>
              <textarea
                ref={textRef}
                value={userText}
                onChange={(event) => {
                  setUserText(event.target.value)
                  if (error) setError('')
                }}
                rows={7}
                placeholder="I rebuilt the checkout flow in React and cut the drop-off rate…"
                className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-[12px] leading-[1.6] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                Skills and tools
              </span>
              <Input
                value={skills}
                onChange={(event) => setSkills(event.target.value)}
                placeholder="React, TypeScript, GraphQL"
                className="mt-1.5"
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Separate with commas. These help match the experience to a posting.
              </span>
            </label>

            {error ? (
              <p
                role="alert"
                className="mt-3 flex items-start gap-1.5 text-[11px] leading-[1.45] text-muted-foreground"
              >
                <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/70 bg-muted/20 px-5 py-3">
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" className="max-sm:h-11" onClick={() => void handleSave()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {story ? 'Save changes' : 'Add experience'}
            </Button>
          </footer>
        </div>
      </div>
    </>
  )
}

export function Profile({ me, onUploadCv, onRefreshMe }: ProfileProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [cvError, setCvError] = useState('')

  const [editing, setEditing] = useState<CvStory | null | undefined>(undefined)
  const [pendingStory, setPendingStory] = useState<CvStory | null>(null)
  const [deletingStory, setDeletingStory] = useState(false)
  const [storyNotice, setStoryNotice] = useState('')
  const [storyError, setStoryError] = useState('')

  const sending = me.sending
  const [sendingMode, setSendingMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [email, setEmail] = useState(sending.email ?? '')
  const [fromName, setFromName] = useState(sending.fromName ?? me.user.name)
  const [apiKey, setApiKey] = useState('')
  const [sendingBusy, setSendingBusy] = useState<'save' | 'test' | 'delete' | null>(null)
  const [sendingError, setSendingError] = useState('')
  const [sendingNotice, setSendingNotice] = useState('')
  const [confirmRemoveIdentity, setConfirmRemoveIdentity] = useState(false)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [telegramError, setTelegramError] = useState('')
  const hasIdentity = Boolean(sending.hasKey && sending.email)

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setCvError('')
    try {
      await onUploadCv(file)
    } catch (caught) {
      setCvError(caught instanceof Error ? caught.message : 'That CV could not be saved.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSaveExperience(story: CvStory) {
    await saveStory(story)
    await onRefreshMe()
    setStoryNotice(story.bullet ? 'Experience updated.' : 'Experience saved.')
    setStoryError('')
  }

  async function confirmDeleteStory() {
    if (!pendingStory) return
    setDeletingStory(true)
    setStoryError('')
    try {
      await deleteStory(pendingStory.id)
      await onRefreshMe()
      setPendingStory(null)
      setStoryNotice('Experience removed.')
    } catch (caught) {
      setStoryError(
        caught instanceof Error ? caught.message : 'That experience could not be removed.',
      )
    } finally {
      setDeletingStory(false)
    }
  }

  function startAddIdentity() {
    setSendingMode('add')
    setEmail(sending.email ?? '')
    setFromName(sending.fromName ?? me.user.name)
    setApiKey('')
    setSendingError('')
    setSendingNotice('')
  }

  function startEditIdentity() {
    setSendingMode('edit')
    setEmail(sending.email ?? '')
    setFromName(sending.fromName ?? me.user.name)
    setApiKey('')
    setSendingError('')
    setSendingNotice('')
  }

  function cancelSendingForm() {
    setSendingMode('idle')
    setApiKey('')
    setSendingError('')
    setSendingNotice('')
  }

  async function handleSaveSending() {
    const adding = sendingMode === 'add'
    if (!email.trim() || (adding && !apiKey.trim())) return

    setSendingBusy('save')
    setSendingError('')
    setSendingNotice('')
    try {
      const result = await saveSending({
        email: email.trim(),
        fromName: fromName.trim() || null,
        apiKey: adding ? apiKey.trim() : undefined,
      })
      setApiKey('')
      setSendingMode('idle')
      setEmail(result.sending.email ?? '')
      setFromName(result.sending.fromName ?? '')
      setSendingNotice(`${result.sending.email} is verified on ${result.sending.domain}.`)
      await onRefreshMe()
    } catch (caught) {
      setSendingError(caught instanceof Error ? caught.message : 'Sending could not be saved.')
    } finally {
      setSendingBusy(null)
    }
  }

  async function handleUnlinkTelegram() {
    setTelegramBusy(true)
    setTelegramError('')
    try {
      await unlinkTelegram()
      await onRefreshMe()
    } catch (caught) {
      setTelegramError(
        caught instanceof Error
          ? caught.message
          : 'Telegram could not be disconnected.',
      )
    } finally {
      setTelegramBusy(false)
    }
  }

  async function handleTestSending() {
    setSendingBusy('test')
    setSendingError('')
    setSendingNotice('')
    try {
      const result = await testSending()
      setSendingNotice(`Resend is connected to ${result.sending.domain}.`)
      await onRefreshMe()
    } catch (caught) {
      setSendingError(caught instanceof Error ? caught.message : 'Resend could not be reached.')
    } finally {
      setSendingBusy(null)
    }
  }

  async function confirmDeleteIdentity() {
    setSendingBusy('delete')
    setSendingError('')
    setSendingNotice('')
    try {
      await deleteSending()
      setApiKey('')
      setEmail('')
      setFromName(me.user.name)
      setSendingMode('idle')
      setConfirmRemoveIdentity(false)
      setSendingNotice('Sending was removed.')
      await onRefreshMe()
    } catch (caught) {
      setConfirmRemoveIdentity(false)
      setSendingError(caught instanceof Error ? caught.message : 'Sending could not be removed.')
    } finally {
      setSendingBusy(null)
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Profile
          </p>
          <h1 className="mt-1.5 text-[26px] leading-[1.08] font-semibold tracking-[-0.035em] text-ink">
            The material behind the applications.
          </h1>
          <p className="mt-2 max-w-[58ch] text-[12.5px] leading-[1.55] text-muted-foreground">
            Your CV and experience on the left, and how applications leave
            Caddie on the right.
          </p>
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="min-w-0 space-y-6">
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>CV</Eyebrow>
                {me.cv ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground hover:text-ink max-sm:h-11"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                    {uploading ? 'Saving…' : 'Replace'}
                  </Button>
                ) : null}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                hidden
                onChange={(event) => void handleUpload(event)}
              />

              {me.cv ? (
                <div className="mt-3 flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-600">
                    <FileText className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-ink">
                      {me.cv.fileName}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      {me.cv.kind === 'docx'
                        ? 'DOCX · Caddie can edit individual bullets'
                        : 'PDF · read-only for tailoring'}{' '}
                      · saved {formatDate(me.cv.updatedAt)}
                    </p>
                    {me.cv.kind === 'pdf' ? (
                      <p className="mt-1 text-[10.5px] text-muted-foreground">
                        Replace it with a DOCX when you want the CV assistant to make
                        edits.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-brand-200 bg-brand-50/40 p-4">
                  <p className="text-[12.5px] font-medium text-ink">Upload your CV</p>
                  <p className="mt-1 max-w-[50ch] text-[11.5px] leading-[1.45] text-muted-foreground">
                    A DOCX keeps its fonts and lets Caddie edit individual bullets.
                    PDFs are accepted, but they are read-only.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3 max-sm:h-11"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                    {uploading ? 'Saving…' : 'Choose a CV'}
                  </Button>
                </div>
              )}

              {cvError ? <Notice className="mt-3">{cvError}</Notice> : null}
            </section>

            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Eyebrow>Experience</Eyebrow>
                  <p className="mt-1 max-w-[52ch] text-[11.5px] leading-[1.45] text-muted-foreground">
                    The work behind the CV. Add the things you actually did; Caddie
                    uses them to ground drafts and CV bullets.
                  </p>
                </div>
                <Button size="sm" className="max-sm:h-11" onClick={() => setEditing(null)}>
                  <Plus />
                  Add
                </Button>
              </div>

              {storyError ? (
                <Notice className="mt-3">{storyError}</Notice>
              ) : storyNotice ? (
                <Notice tone="success" className="mt-3">
                  {storyNotice}
                </Notice>
              ) : null}

              {me.stories.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/15 px-4 py-6 text-center">
                  <p className="text-[12px] font-medium text-ink">No experience saved yet.</p>
                  <p className="mx-auto mt-1 max-w-[44ch] text-[11px] leading-[1.5] text-muted-foreground">
                    Add one project or role. Future letters and email drafts can
                    use it without asking again.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3 bg-card max-sm:h-11" onClick={() => setEditing(null)}>
                    <Plus />
                    Add experience
                  </Button>
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-border/70">
                  {me.stories.map((story) => (
                    <li key={story.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-ink">
                            {story.title || 'Experience'}
                            {story.company ? (
                              <span className="font-normal text-muted-foreground">
                                {' '}· {story.company}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 line-clamp-3 text-[11.5px] leading-[1.5] text-muted-foreground">
                            {story.userText}
                          </p>
                          {story.skills.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {story.skills.map((skill) => (
                                <span
                                  key={skill}
                                  className="rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] text-muted-foreground"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-ink max-sm:size-11"
                            onClick={() => setEditing(story)}
                            aria-label={`Edit ${story.title ?? 'experience'}`}
                            title="Edit experience"
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive max-sm:size-11"
                            onClick={() => {
                              setStoryError('')
                              setPendingStory(story)
                            }}
                            aria-label={`Delete ${story.title ?? 'experience'}`}
                            title="Delete experience"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-6 border-t border-border/70 pt-5">
                <PublicWork bare me={me} onRefreshMe={onRefreshMe} />
              </div>
            </section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-20">
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Eyebrow>Sending</Eyebrow>
                  <p className="mt-1 text-[11.5px] leading-[1.45] text-muted-foreground">
                    Applications are sent through your own Resend account. The key
                    stays encrypted and never comes back to this browser.
                  </p>
                </div>
                {hasIdentity ? (
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium ${
                      sending.verified
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {sending.verified ? 'Verified' : 'Check domain'}
                  </span>
                ) : null}
              </div>

              {hasIdentity && sendingMode === 'idle' ? (
                <div className="mt-4">
                  <div className="rounded-lg border border-border/70 bg-muted/15 p-3">
                    <div className="flex items-start gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-600">
                        <Mail className="size-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-ink">
                          {sending.fromName
                            ? `${sending.fromName} <${sending.email}>`
                            : sending.email}
                        </p>
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {sending.verified
                            ? `Verified on ${sending.domain}`
                            : 'Saved. Check the domain before sending'}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border/70 pt-3 text-[10.5px]">
                      <dt className="text-muted-foreground">From</dt>
                      <dd className="truncate text-ink">{sending.email}</dd>
                      <dt className="text-muted-foreground">Domain</dt>
                      <dd className="truncate text-ink">{sending.domain}</dd>
                      <dt className="text-muted-foreground">API key</dt>
                      <dd className="text-ink">•••• {sending.keyLast4 ?? 'saved'}</dd>
                    </dl>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      className="max-sm:h-11"
                      onClick={startEditIdentity}
                      disabled={sendingBusy !== null}
                    >
                      <Pencil />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-sm:h-11"
                      onClick={() => void handleTestSending()}
                      disabled={sendingBusy !== null}
                    >
                      {sendingBusy === 'test' ? <LoaderCircle className="animate-spin" /> : null}
                      Check
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive max-sm:h-11"
                      onClick={() => setConfirmRemoveIdentity(true)}
                      disabled={sendingBusy !== null}
                    >
                      {sendingBusy === 'delete' ? <LoaderCircle className="animate-spin" /> : null}
                      Remove
                    </Button>
                  </div>

                  <p className="mt-2 text-[10px] leading-[1.45] text-muted-foreground">
                    To replace the key, remove Sending and add it again.
                  </p>
                </div>
              ) : sendingMode === 'idle' ? (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/15 px-4 py-6 text-center">
                  <span className="mx-auto flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                    <Mail className="size-4" strokeWidth={1.75} />
                  </span>
                  <p className="mt-3 text-[12px] font-medium text-ink">
                    No sending address yet.
                  </p>
                  <p className="mx-auto mt-1 max-w-[38ch] text-[11px] leading-[1.5] text-muted-foreground">
                    Add the address applications should come from. Caddie checks
                    the domain with Resend, then stores the key encrypted.
                  </p>
                  <Button size="sm" className="mt-3 max-sm:h-11" onClick={startAddIdentity}>
                    <Plus />
                    Add sending
                  </Button>
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-[11px] leading-[1.45] text-muted-foreground">
                    {sendingMode === 'add'
                      ? 'Add the address and a Resend key. The key is checked against your verified domains first.'
                      : 'Edit the from address and sender name. The stored key stays encrypted.'}
                  </p>

                  <label className="mt-4 block">
                    <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                      Send from
                    </span>
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@yourdomain.com"
                      autoComplete="email"
                      className="mt-1.5"
                    />
                  </label>

                  <label className="mt-3 block">
                    <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                      Sender name
                    </span>
                    <Input
                      value={fromName}
                      onChange={(event) => setFromName(event.target.value)}
                      placeholder={me.user.name || 'Your name'}
                      autoComplete="name"
                      className="mt-1.5"
                    />
                  </label>

                  {sendingMode === 'add' ? (
                    <>
                      <label className="mt-3 block">
                        <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
                          Resend API key
                        </span>
                        <div className="relative mt-1.5">
                          <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
                          <Input
                            type="password"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder="re_…"
                            autoComplete="off"
                            spellCheck={false}
                            className="pl-8"
                          />
                        </div>
                      </label>
                      <p className="mt-2 text-[10px] leading-[1.45] text-muted-foreground">
                        The key is checked against your verified Resend domains, then
                        encrypted on the server. Only the last four characters are
                        returned here.
                      </p>
                    </>
                  ) : (
                    <p className="mt-3 text-[10px] leading-[1.45] text-muted-foreground">
                      The stored key ends in {sending.keyLast4 ?? '••••'}. To use a
                      different key, remove the identity and add it again.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      className="max-sm:h-11"
                      onClick={() => void handleSaveSending()}
                      disabled={
                        sendingBusy !== null ||
                        !email.trim() ||
                        (sendingMode === 'add' && !apiKey.trim())
                      }
                    >
                      {sendingBusy === 'save' ? <LoaderCircle className="animate-spin" /> : null}
                      {sendingMode === 'add' ? 'Add identity' : 'Save details'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-ink max-sm:h-11"
                      onClick={cancelSendingForm}
                      disabled={sendingBusy !== null}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {sendingError ? (
                <Notice className="mt-3">{sendingError}</Notice>
              ) : sendingNotice ? (
                <Notice tone="success" className="mt-3">
                  {sendingNotice}
                </Notice>
              ) : null}

              <div className="mt-4 flex items-start gap-2 border-t border-border/70 pt-3 text-[10px] leading-[1.45] text-muted-foreground">
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" strokeWidth={1.75} />
                <span>
                  Sending uses the key only when you press Send. Removing the
                  identity stops email sending immediately.
                </span>
              </div>

              <a
                href="https://resend.com/domains"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[10.5px] text-brand-700 outline-none hover:underline max-sm:min-h-11 max-sm:py-2 focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Verify a domain in Resend
                <ExternalLink className="size-3" strokeWidth={1.75} />
              </a>
            </section>

            <section className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Eyebrow>Telegram</Eyebrow>
                  <p className="mt-1 text-[11.5px] leading-[1.45] text-muted-foreground">
                    Use Caddie from Telegram for application intake, previews and
                    email sending.
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium ${
                    me.telegram.connected
                      ? 'bg-success/10 text-success'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {me.telegram.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>

              {me.telegram.connected ? (
                <div className="mt-4">
                  <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/15 p-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-600">
                      <MessageCircle className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium text-ink">
                        {me.telegram.username
                          ? `@${me.telegram.username}`
                          : me.telegram.firstName || 'Telegram connected'}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                        Auto-apply {me.telegram.autoApply ? 'on' : 'off'}
                        {me.telegram.linkedAt
                          ? ` · since ${formatDate(me.telegram.linkedAt)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-muted-foreground hover:text-destructive max-sm:h-11"
                    onClick={() => void handleUnlinkTelegram()}
                    disabled={telegramBusy}
                  >
                    {telegramBusy ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Unplug />
                    )}
                    {telegramBusy ? 'Disconnecting…' : 'Disconnect Telegram'}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/15 px-3 py-3">
                  <p className="text-[10.5px] leading-[1.5] text-muted-foreground">
                    Open the Caddie bot in Telegram and send /start. It will
                    give you a sign-in link to connect this account.
                  </p>
                  {me.telegram.botUrl ? (
                    <a
                      href={me.telegram.botUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md text-[11px] font-medium text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open Caddie in Telegram
                      <ExternalLink className="size-3.5" strokeWidth={1.75} />
                    </a>
                  ) : null}
                </div>
              )}

              {telegramError ? (
                <Notice className="mt-2 text-[10.5px]">{telegramError}</Notice>
              ) : null}
            </section>

            <p className="mt-3 flex items-start gap-2 px-1 text-[10px] leading-[1.45] text-muted-foreground">
              <Mail className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
              Signed in as {me.user.email}. The sending address above can be
              different; it must be on a domain Resend has verified.
            </p>
          </aside>
        </div>
      </div>

      {editing !== undefined ? (
        <ExperienceDialog
          key={editing?.id ?? 'new'}
          open
          story={editing ?? null}
          onClose={() => setEditing(undefined)}
          onSaved={handleSaveExperience}
        />
      ) : null}

      <ConfirmDialog
        open={confirmRemoveIdentity}
        title="Remove sending?"
        description="This removes the from address and Resend key. Email sending stops immediately. You can add it again later."
        confirmLabel="Remove sending"
        busy={sendingBusy === 'delete'}
        destructive
        onConfirm={() => void confirmDeleteIdentity()}
        onClose={() => {
          if (sendingBusy !== 'delete') setConfirmRemoveIdentity(false)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingStory)}
        title="Delete this experience?"
        description="It will no longer be available to ground future CV edits, letters or emails."
        confirmLabel="Delete experience"
        busy={deletingStory}
        destructive
        onConfirm={() => void confirmDeleteStory()}
        onClose={() => {
          if (!deletingStory) setPendingStory(null)
        }}
      >
        {pendingStory ? pendingStory.userText : null}
      </ConfirmDialog>
    </main>
  )
}
