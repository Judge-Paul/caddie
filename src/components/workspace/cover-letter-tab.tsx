import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Eyebrow, Notice } from '@/components/ui/section'
import { composeApplication, downloadApplicationCoverLetter } from '@/lib/account'
import type { ApplicationDetail, UpdateApplicationPatch } from '@shared/account'
import {
  Check,
  Copy,
  Download,
  LoaderCircle,
  LockKeyhole,
  PenLine,
  Sparkles,
} from 'lucide-react'

type CoverLetterTabProps = {
  application: ApplicationDetail
  canCompose: boolean
  locked: boolean
  onUpdated: (application: ApplicationDetail) => void
  onUpdate: (patch: UpdateApplicationPatch) => Promise<void>
  onOpenProfile: () => void
}

export function CoverLetterTab({
  application,
  canCompose,
  locked,
  onUpdated,
  onUpdate,
  onOpenProfile,
}: CoverLetterTabProps) {
  const [text, setText] = useState(application.coverLetter?.text ?? '')
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [downloadBusy, setDownloadBusy] = useState(false)

  const savedText = application.coverLetter?.text ?? ''
  const dirty = text !== savedText
  const words = useMemo(() => {
    const trimmed = text.trim()
    return trimmed ? trimmed.split(/\s+/).length : 0
  }, [text])

  async function generate() {
    setConfirmGenerate(false)
    setBusy('generate')
    setError('')
    setNotice('')
    try {
      const updated = await composeApplication(application.id, 'cover-letter')
      onUpdated(updated)
      setText(updated.coverLetter?.text ?? '')
      setNotice('Draft written from your CV and saved experiences.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The cover letter could not be drafted.')
    } finally {
      setBusy(null)
    }
  }

  function requestGenerate() {
    if (text.trim()) setConfirmGenerate(true)
    else void generate()
  }

  async function save(quiet = false) {
    if (locked || busy) return false
    if (!dirty) return true
    if (!quiet) setBusy('save')
    setError('')
    if (!quiet) setNotice('')
    try {
      await onUpdate({
        coverLetter: text.trim()
          ? { text, updatedAt: new Date().toISOString() }
          : null,
      })
      setText(text.trim())
      if (!quiet) setNotice('Saved.')
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The cover letter could not be saved.')
      return false
    } finally {
      if (!quiet) setBusy(null)
    }
  }

  function openProfile() {
    if (dirty) void save(true)
    onOpenProfile()
  }

  async function download() {
    if (!text.trim()) return
    if (!locked && dirty && !(await save())) return
    setDownloadBusy(true)
    setError('')
    try {
      await downloadApplicationCoverLetter(application.id, 'Cover-Letter.pdf')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The cover letter could not be downloaded.')
    } finally {
      setDownloadBusy(false)
    }
  }

  async function copy() {
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Could not copy the letter. Select the text and copy it manually.')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Letter</Eyebrow>
          <h2 className="mt-1 text-[18px] leading-tight font-semibold tracking-[-0.025em] text-ink">
            A letter grounded in your work.
          </h2>
          <p className="mt-1 max-w-[54ch] text-[11.5px] leading-[1.5] text-muted-foreground">
            Caddie uses the CV, the posting and your experience library. You can edit
            every line before it is sent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {text ? (
            <Button
              variant="outline"
              size="sm"
              className="bg-card max-sm:h-11"
              onClick={() => void download()}
              disabled={downloadBusy}
            >
              {downloadBusy ? <LoaderCircle className="animate-spin" /> : <Download />}
              Download PDF
            </Button>
          ) : null}
          {locked ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[10.5px] text-muted-foreground">
              <LockKeyhole className="size-3" strokeWidth={1.75} />
              Locked
            </span>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="bg-card max-sm:h-11"
                onClick={requestGenerate}
                disabled={!canCompose || busy !== null}
              >
                {busy === 'generate' ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                {busy === 'generate' ? 'Drafting…' : text ? 'Regenerate' : 'Draft letter'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-ink max-sm:h-11"
                onClick={openProfile}
              >
                Experiences
              </Button>
            </>
          )}
        </div>
      </div>

      {!locked && !canCompose ? (
        <Notice className="mt-3">
          Caddie needs a read posting and selectable CV text before it can draft.
        </Notice>
      ) : null}

      {locked ? (
        <Notice className="mt-3">
          This letter is locked after sending or completion. It can still be downloaded.
        </Notice>
      ) : null}

      {error ? (
        <Notice className="mt-3">{error}</Notice>
      ) : notice ? (
        <Notice tone="success" className="mt-3">
          {notice}
        </Notice>
      ) : null}

      <div className="paper-shadow mx-auto mt-4 w-full max-w-[660px] bg-white px-6 py-7 ring-1 ring-black/[0.04] sm:px-10 sm:py-9">
        {text ? (
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              if (notice) setNotice('')
            }}
            aria-label="Cover letter"
            spellCheck
            readOnly={locked}
            className="min-h-[520px] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[13px] leading-[1.75] text-ink outline-none transition-colors [field-sizing:content] focus-visible:bg-brand-50/25 focus-visible:ring-0"
          />
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center px-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
              <PenLine className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-3 text-[13px] font-medium text-ink">Start with the evidence.</p>
            <p className="mt-1 max-w-[42ch] text-[11.5px] leading-[1.5] text-muted-foreground">
              Caddie will write three or four specific paragraphs from your CV and
              the work you have saved. Nothing is invented.
            </p>
            {locked ? (
              <p className="mt-4 max-w-[40ch] text-[11px] leading-[1.5] text-muted-foreground">
                This application is locked. No cover letter was saved.
              </p>
            ) : (
              <Button
                className="mt-4"
                size="sm"
                onClick={() => void generate()}
                disabled={!canCompose || busy !== null}
              >
                {busy === 'generate' ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                {busy === 'generate' ? 'Drafting…' : 'Draft cover letter'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] tabular-nums text-muted-foreground">
          {words} {words === 1 ? 'word' : 'words'}
          {locked
            ? ' · locked'
            : dirty
              ? ' · unsaved changes'
              : application.coverLetter
                ? ' · saved'
                : ''}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-ink max-sm:h-11"
            onClick={() => void copy()}
            disabled={!text.trim()}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {!locked ? (
            <Button
              size="sm"
              className="max-sm:h-11"
              onClick={() => void save()}
              disabled={!dirty || busy !== null}
            >
              {busy === 'save' ? <LoaderCircle className="animate-spin" /> : null}
              Save letter
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmGenerate}
        title="Replace the cover letter?"
        description="Generating again will replace the current text. Save it first if you want to keep it."
        confirmLabel="Generate again"
        busy={busy === 'generate'}
        onConfirm={() => void generate()}
        onClose={() => {
          if (busy !== 'generate') setConfirmGenerate(false)
        }}
      />
    </div>
  )
}
