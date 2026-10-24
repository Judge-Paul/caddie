import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'
import type { AccountMe, ApplicationSummary } from '@shared/account'
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  FileText,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

type DashboardProps = {
  me: AccountMe
  openingId: string | null
  actionError: string
  onOpenApplication: (id: string) => void
  onCreateApplication: (jdText: string) => Promise<void>
  onDeleteApplication: (id: string) => Promise<void>
  onUploadCv: (file: File) => Promise<void>
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

function statusLabel(status: ApplicationSummary['status']) {
  if (status === 'customized') return 'CV tailored'
  if (status === 'classified') return 'Posting read'
  return 'Draft'
}

function statusClass(status: ApplicationSummary['status']) {
  if (status === 'customized') return 'bg-success/10 text-success'
  if (status === 'classified') return 'bg-brand-50 text-brand-700'
  return 'bg-muted text-muted-foreground'
}

function NewApplicationDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (jdText: string) => Promise<void>
}) {
  const [jdText, setJdText] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  if (!open) return null

  async function handleCreate() {
    if (jdText.trim().length < 40) {
      setError('Paste the full posting first.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onCreate(jdText.trim())
      setJdText('')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the application.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]"
        onClick={() => {
          if (!submitting) onClose()
        }}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New application"
          className="pointer-events-auto flex max-h-[84vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_80px_-30px_rgba(13,21,38,0.5)]"
        >
        <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              New application
            </p>
            <h2 className="mt-1 text-[16px] leading-none font-semibold tracking-[-0.015em] text-ink">
              Paste the job description
            </h2>
            <p className="mt-1.5 text-[11.5px] leading-[1.45] text-muted-foreground">
              Caddie will read the posting and tailor the CV copied from your
              profile.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-ink"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close new application"
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <label
            htmlFor="new-application-jd"
            className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
          >
            Job description
          </label>
          <textarea
            id="new-application-jd"
            ref={textareaRef}
            value={jdText}
            onChange={(event) => {
              setJdText(event.target.value)
              if (error) setError('')
            }}
            rows={14}
            spellCheck={false}
            placeholder="Paste the role, requirements and responsibilities…"
            className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-[12px] leading-[1.6] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />

          {error ? (
            <p
              role="alert"
              className="mt-2 flex items-start gap-1.5 text-[11px] leading-[1.45] text-muted-foreground"
            >
              <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/70 bg-muted/20 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={submitting || jdText.trim().length < 40}
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Create application
          </Button>
          </footer>
        </div>
      </div>
    </>
  )
}

function ApplicationCard({
  application,
  opening,
  onOpen,
  onDelete,
}: {
  application: ApplicationSummary
  opening: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13.5px] leading-[1.35] font-semibold tracking-[-0.015em] text-ink">
            {application.title ?? 'Untitled application'}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {application.company ?? 'Company not read yet'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium ${statusClass(application.status)}`}
        >
          {statusLabel(application.status)}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          Created {formatDate(application.createdAt)}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${application.title ?? 'application'}`}
          >
            <Trash2 />
          </Button>
          <Button variant="outline" size="sm" onClick={onOpen} disabled={opening}>
            {opening ? <LoaderCircle className="animate-spin" /> : null}
            Open
            {!opening ? <ArrowRight /> : null}
          </Button>
        </div>
      </div>
    </article>
  )
}

export function Dashboard({
  me,
  openingId,
  actionError,
  onOpenApplication,
  onCreateApplication,
  onDeleteApplication,
  onUploadCv,
}: DashboardProps) {
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasCv = Boolean(me.cv)
  const applications = me.applications

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError('')
    try {
      await onUploadCv(file)
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : 'That CV could not be saved.',
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm(
      'Delete this application? The tailored CV will be removed with it.',
    )
    if (!confirmed) return
    try {
      await onDeleteApplication(id)
    } catch (caught) {
      setUploadError(
        caught instanceof Error ? caught.message : 'That application could not be deleted.',
      )
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(100%_80%_at_50%_-10%,#ffffff_0%,#f4f6fb_55%,#edf0f7_100%)]">
      <div className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Applications
            </p>
            <h1 className="mt-1.5 text-[24px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink">
              Prepare for the next role.
            </h1>
            <p className="mt-2 max-w-[52ch] text-[12.5px] leading-[1.55] text-muted-foreground">
              Each application keeps its own posting and tailored CV, so you can
              come back to it before you send anything.
            </p>
          </div>
          <Button
            size="sm"
            className="h-9"
            onClick={() => setCreating(true)}
            disabled={!hasCv}
            title={hasCv ? undefined : 'Upload a CV first'}
          >
            <Plus />
            New application
          </Button>
        </div>

        {actionError || uploadError ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-[11.5px] leading-[1.45] text-muted-foreground"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
            {actionError || uploadError}
          </p>
        ) : null}

        <section className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Your CV
            </h2>
            {hasCv ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-ink"
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-brand-600">
                  <FileText className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-ink">
                    {me.cv.fileName}
                  </p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {me.cv.kind === 'docx'
                      ? 'DOCX · editable for tailoring'
                      : 'PDF · read-only for tailoring'}{' '}
                    · saved {formatDate(me.cv.updatedAt)}
                  </p>
                </div>
              </div>
              {me.cv.kind === 'pdf' ? (
                <p className="text-[10.5px] text-muted-foreground">
                  Replace with a DOCX to let Caddie edit bullets.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-card text-brand-600">
                    <FileText className="size-4" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">
                      Upload your CV to start
                    </p>
                    <p className="mt-1 max-w-[52ch] text-[11.5px] leading-[1.45] text-muted-foreground">
                      A DOCX keeps its fonts and lets Caddie tailor individual
                      bullets. PDFs are accepted, but they are read-only.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-9"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                  {uploading ? 'Saving…' : 'Upload CV'}
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Applications
            </h2>
            <span className="text-[10.5px] tabular-nums text-muted-foreground">
              {applications.length}
            </span>
          </div>

          {applications.length === 0 ? (
            <div className="mt-2 flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
                <BriefcaseBusiness className="size-5" strokeWidth={1.75} />
              </div>
              <p className="mt-3 text-[13px] font-medium text-ink">
                No applications yet
              </p>
              <p className="mt-1 max-w-[40ch] text-[11.5px] leading-[1.5] text-muted-foreground">
                {hasCv
                  ? 'Paste a job description and Caddie will prepare it against your CV.'
                  : 'Upload your CV, then paste a job description to prepare your first application.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 bg-card"
                onClick={() => (hasCv ? setCreating(true) : fileInputRef.current?.click())}
                disabled={uploading}
              >
                {hasCv ? <Plus /> : <Upload />}
                {hasCv ? 'New application' : 'Upload CV'}
              </Button>
            </div>
          ) : (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {applications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  opening={openingId === application.id}
                  onOpen={() => onOpenApplication(application.id)}
                  onDelete={() => void handleDelete(application.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {creating ? (
        <NewApplicationDialog
          open
          onClose={() => setCreating(false)}
          onCreate={onCreateApplication}
        />
      ) : null}
    </main>
  )
}
