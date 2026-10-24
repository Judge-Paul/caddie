import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import {
  applicationStage,
  STAGE_LABELS,
  stageClass,
  stageDot,
} from '@/lib/application-stage'
import type { AccountMe, ApplicationSummary } from '@shared/account'
import {
  AlertCircle,
  ArrowUpRight,
  BriefcaseBusiness,
  FileText,
  LoaderCircle,
  Mail,
  PenLine,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

type DashboardProps = {
  me: AccountMe
  openingId: string | null
  actionError: string
  onOpenApplication: (id: string) => void
  onOpenProfile: () => void
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

function formatUpdated(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((start.getTime() - day.getTime()) / 86_400_000)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return formatDate(value)
}

function monogram(application: ApplicationSummary) {
  const source = application.company || application.title || '?'
  return source.trim().slice(0, 1).toUpperCase()
}

const STAGES = ['draft', 'reading', 'tailored', 'ready', 'completed', 'sent'] as const

function PackageIcons({ application }: { application: ApplicationSummary }) {
  const label = [
    'CV',
    application.hasCoverLetter ? 'cover letter' : 'no cover letter',
    application.hasEmailDraft ? 'email draft' : 'no email draft',
  ].join(', ')

  return (
    <div
      role="img"
      aria-label={`Application package: ${label}`}
      className="flex items-center gap-1"
    >
      <span
        title="CV snapshot"
        className="flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-600"
      >
        <FileText className="size-3.5" strokeWidth={1.75} />
      </span>
      <span
        title={application.hasCoverLetter ? 'Cover letter drafted' : 'No cover letter'}
        className={
          application.hasCoverLetter
            ? 'flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-600'
            : 'flex size-6 items-center justify-center rounded-md bg-muted/60 text-muted-foreground/45'
        }
      >
        <PenLine className="size-3.5" strokeWidth={1.75} />
      </span>
      <span
        title={application.hasEmailDraft ? 'Email drafted' : 'No email draft'}
        className={
          application.hasEmailDraft
            ? 'flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-600'
            : 'flex size-6 items-center justify-center rounded-md bg-muted/60 text-muted-foreground/45'
        }
      >
        <Mail className="size-3.5" strokeWidth={1.75} />
      </span>
    </div>
  )
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
                Caddie will read the posting and open an application workspace.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-ink max-sm:size-11"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close new application"
            >
              <X />
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
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
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="max-sm:h-11"
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

function ApplicationRow({
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
  const stage = applicationStage(application)
  const title = application.title ?? 'Untitled application'
  const company = application.company ?? 'Company not read yet'

  return (
    <tr className="group border-t border-border/70 transition-colors hover:bg-muted/25">
      <td className="w-full max-w-0 py-3 pr-4 pl-4 sm:pl-5">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 items-center gap-3 text-left outline-none focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-100 bg-brand-50 text-[12px] font-semibold text-brand-700">
            {monogram(application)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] leading-[1.35] font-medium text-ink">
              {title}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {company}
            </span>
            <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground sm:hidden">
              Updated {formatUpdated(application.updatedAt)}
            </span>
          </span>
        </button>
      </td>

      <td className="py-3 pr-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${stageClass(stage)}`}
        >
          <span className={`size-1.5 rounded-full ${stageDot(stage)}`} />
          {STAGE_LABELS[stage]}
        </span>
      </td>

      <td className="hidden py-3 pr-3 md:table-cell">
        <PackageIcons application={application} />
      </td>

      <td className="hidden py-3 pr-3 text-[11px] tabular-nums text-muted-foreground sm:table-cell">
        {formatUpdated(application.updatedAt)}
      </td>

      <td className="py-3 pr-3 whitespace-nowrap">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive max-sm:size-11"
            onClick={onDelete}
            aria-label={`Delete ${title}`}
            title={`Delete ${title}`}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-ink max-sm:h-11 max-sm:px-3"
            onClick={onOpen}
            disabled={opening}
            aria-label={`Open ${title}`}
          >
            {opening ? <LoaderCircle className="animate-spin" /> : null}
            <span className="hidden sm:inline">Open</span>
            {!opening ? <ArrowUpRight /> : null}
          </Button>
        </div>
      </td>
    </tr>
  )
}

export function Dashboard({
  me,
  openingId,
  actionError,
  onOpenApplication,
  onOpenProfile,
  onCreateApplication,
  onDeleteApplication,
  onUploadCv,
}: DashboardProps) {
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | (typeof STAGES)[number]>('all')
  const [pendingDelete, setPendingDelete] = useState<ApplicationSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasCv = Boolean(me.cv)
  const applications = me.applications

  const counts = applications.reduce<Record<string, number>>(
    (current, application) => {
      const stage = applicationStage(application)
      current[stage] = (current[stage] ?? 0) + 1
      return current
    },
    {},
  )

  const filtered = applications.filter((application) => {
    const stage = applicationStage(application)
    if (filter !== 'all' && stage !== filter) return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return (
      (application.title ?? '').toLowerCase().includes(query) ||
      (application.company ?? '').toLowerCase().includes(query)
    )
  })

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

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setUploadError('')
    try {
      await onDeleteApplication(pendingDelete.id)
      setPendingDelete(null)
    } catch (caught) {
      setUploadError(
        caught instanceof Error
          ? caught.message
          : 'That application could not be deleted.',
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Applications
            </p>
            <h1 className="mt-1.5 text-[26px] leading-[1.08] font-semibold tracking-[-0.035em] text-ink">
              Every role in play.
            </h1>
            <p className="mt-2 max-w-[56ch] text-[12.5px] leading-[1.55] text-muted-foreground">
              The posting, the CV and everything you send, kept together.
            </p>
            {me.cv ? (
              <button
                type="button"
                onClick={onOpenProfile}
                className="mt-3 inline-flex max-w-full items-center gap-1.5 text-[10.5px] text-muted-foreground outline-none hover:text-ink max-sm:min-h-11 max-sm:py-2 focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <FileText className="size-3 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{me.cv.fileName}</span>
                <span className="shrink-0 text-muted-foreground/70">
                  · {me.cv.kind.toUpperCase()} · Manage
                </span>
              </button>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
            hidden
            onChange={(event) => void handleUpload(event)}
          />

          {hasCv ? (
            <Button size="sm" className="h-9 max-sm:h-11" onClick={() => setCreating(true)}>
              <Plus />
              New application
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-9 max-sm:h-11"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {uploading ? 'Saving…' : 'Upload CV'}
            </Button>
          )}
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
          {applications.length > 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-[280px]">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a role or company"
                  aria-label="Find an application"
                  className="pl-8 max-sm:h-11"
                />
              </div>

              <div
                className="flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5 [scrollbar-width:none] sm:flex-nowrap sm:overflow-x-auto [&::-webkit-scrollbar]:hidden"
                role="group"
                aria-label="Filter applications by stage"
              >
                <FilterButton
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                  label="All"
                  count={applications.length}
                />
                {STAGES.map((stage) => (
                  <FilterButton
                    key={stage}
                    active={filter === stage}
                    onClick={() => setFilter(stage)}
                    label={STAGE_LABELS[stage]}
                    count={counts[stage] ?? 0}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            {applications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
                  <BriefcaseBusiness className="size-5" strokeWidth={1.75} />
                </div>
                <p className="mt-3 text-[13px] font-medium text-ink">No applications yet</p>
                <p className="mt-1 max-w-[42ch] text-[11.5px] leading-[1.5] text-muted-foreground">
                  {hasCv
                    ? 'Paste a posting and Caddie will build the application around it.'
                    : 'Upload your CV, then paste a posting to start the first application.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 bg-card max-sm:h-11"
                  onClick={() => (hasCv ? setCreating(true) : fileInputRef.current?.click())}
                  disabled={uploading}
                >
                  {hasCv ? <Plus /> : <Upload />}
                  {hasCv ? 'New application' : 'Upload CV'}
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-[13px] font-medium text-ink">Nothing in this view.</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  Try another stage or clear the search.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 text-muted-foreground hover:text-ink"
                  onClick={() => {
                    setFilter('all')
                    setSearch('')
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-muted/35 text-[9.5px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    <th scope="col" className="py-2.5 pr-4 pl-4 font-semibold sm:pl-5">
                      Role
                    </th>
                    <th scope="col" className="py-2.5 pr-3 font-semibold">
                      Stage
                    </th>
                    <th scope="col" className="hidden py-2.5 pr-3 font-semibold md:table-cell">
                      Package
                    </th>
                    <th scope="col" className="hidden py-2.5 pr-3 font-semibold sm:table-cell">
                      Updated
                    </th>
                    <th scope="col" className="py-2.5 pr-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((application) => (
                    <ApplicationRow
                      key={application.id}
                      application={application}
                      opening={openingId === application.id}
                      onOpen={() => onOpenApplication(application.id)}
                      onDelete={() => {
                        setPendingDelete(application)
                        setUploadError('')
                      }}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {creating ? (
        <NewApplicationDialog
          open
          onClose={() => setCreating(false)}
          onCreate={onCreateApplication}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete ${pendingDelete.title ?? 'application'}?` : 'Delete application?'}
        description="The posting, CV snapshot, cover letter and email draft in this application will be removed."
        confirmLabel="Delete application"
        busy={deleting}
        destructive
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
      >
        {pendingDelete ? (
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-ink">
              {pendingDelete.title ?? 'Untitled application'}
            </span>
            <span className="shrink-0 text-[10px]">
              Last updated {formatUpdated(pendingDelete.updatedAt)}
            </span>
          </span>
        ) : null}
      </ConfirmDialog>
    </main>
  )
}

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1 rounded-[7px] px-2 py-1 max-sm:min-h-11 max-sm:px-3 text-[11px] font-medium whitespace-nowrap transition-colors ${
        active
          ? 'bg-card text-ink shadow-[0_1px_2px_rgba(13,21,38,0.08)]'
          : 'text-muted-foreground hover:text-ink'
      }`}
    >
      {label}
      <span className="text-[9.5px] tabular-nums opacity-60">{count}</span>
    </button>
  )
}
