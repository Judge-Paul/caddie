import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { composeApplication, sendApplication } from '@/lib/account'
import type {
  ApplicationDetail,
  SendingSettings,
  UpdateApplicationPatch,
} from '@shared/account'
import {
  AlertCircle,
  Check,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Paperclip,
  Send,
  Sparkles,
} from 'lucide-react'

type EmailTabProps = {
  application: ApplicationDetail
  sending: SendingSettings
  canCompose: boolean
  applicationEmail: string | null
  locked: boolean
  onUpdated: (application: ApplicationDetail) => void
  onUpdate: (patch: UpdateApplicationPatch) => Promise<void>
  onOpenProfile: () => void
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
}

export function EmailTab({
  application,
  sending,
  canCompose,
  applicationEmail,
  locked,
  onUpdated,
  onUpdate,
  onOpenProfile,
}: EmailTabProps) {
  const draft = application.emailDraft
  const [to, setTo] = useState(draft?.to || applicationEmail || '')
  const [subject, setSubject] = useState(draft?.subject ?? '')
  const [body, setBody] = useState(draft?.body ?? '')
  const [attachCv, setAttachCv] = useState(true)
  const [busy, setBusy] = useState<'generate' | 'save' | 'send' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)

  const connected = sending.hasKey && sending.verified
  const saved = application.emailDraft
  const dirty =
    to !== (saved?.to ?? '') ||
    subject !== (saved?.subject ?? '') ||
    body !== (saved?.body ?? '')
  const canSend =
    !locked && connected && Boolean(to.trim() && subject.trim() && body.trim())
  const from = sending.fromName
    ? `${sending.fromName} <${sending.email}>`
    : sending.email

  async function generate() {
    if (locked) return
    setConfirmGenerate(false)
    setBusy('generate')
    setError('')
    setNotice('')
    try {
      const updated = await composeApplication(application.id, 'email')
      onUpdated(updated)
      setTo(updated.emailDraft?.to || applicationEmail || to)
      setSubject(updated.emailDraft?.subject ?? '')
      setBody(updated.emailDraft?.body ?? '')
      setNotice('Email draft written from your CV and saved experiences.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The email could not be drafted.')
    } finally {
      setBusy(null)
    }
  }

  function requestGenerate() {
    if (subject.trim() || body.trim()) setConfirmGenerate(true)
    else void generate()
  }

  async function save(quiet = false) {
    if (locked || !dirty || busy) return
    if (!quiet) setBusy('save')
    setError('')
    if (!quiet) setNotice('')
    try {
      await onUpdate({
        emailDraft:
          subject.trim() || body.trim()
            ? {
                to: to.trim(),
                subject: subject.trim(),
                body,
                updatedAt: new Date().toISOString(),
              }
            : null,
      })
      setTo(to.trim())
      setSubject(subject.trim())
      setBody(body.trim())
      if (!quiet) setNotice('Draft saved.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The email draft could not be saved.')
    } finally {
      if (!quiet) setBusy(null)
    }
  }

  function openProfile() {
    if (dirty) void save(true)
    onOpenProfile()
  }

  async function send() {
    if (locked) return
    setConfirmSend(false)
    setBusy('send')
    setError('')
    setNotice('')
    try {
      const updated = await sendApplication(application.id, {
        to: to.trim(),
        subject: subject.trim(),
        body,
        attachCv,
      })
      onUpdated(updated)
      setNotice(
        updated.sentAt
          ? `Sent to ${updated.sentTo} at ${formatDateTime(updated.sentAt)}.`
          : 'Application sent.',
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The application could not be sent.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Email
          </p>
          <h2 className="mt-1 text-[18px] leading-tight font-semibold tracking-[-0.025em] text-ink">
            Send it from your own address.
          </h2>
          <p className="mt-1 max-w-[56ch] text-[11.5px] leading-[1.5] text-muted-foreground">
            This is the short application note. The CV is attached as a PDF; the
            cover letter stays here as your own copy.
          </p>
        </div>
        {!locked ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="bg-card max-sm:h-11"
              onClick={requestGenerate}
              disabled={!canCompose || busy !== null}
            >
              {busy === 'generate' ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {busy === 'generate' ? 'Drafting…' : subject || body ? 'Regenerate' : 'Draft email'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-ink max-sm:h-11"
              onClick={() => void save()}
              disabled={!dirty || busy !== null}
            >
              {busy === 'save' ? <LoaderCircle className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[10.5px] text-muted-foreground">
            <LockKeyhole className="size-3" strokeWidth={1.75} />
            Locked
          </span>
        )}
      </div>

      {locked ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-[1.45] text-muted-foreground">
          <LockKeyhole className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
          {application.sentAt
            ? 'This application was sent. The email is kept as a record.'
            : 'This application was completed. The email is kept as a record.'}
        </p>
      ) : null}

      {!locked && !connected ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
          <p className="flex max-w-[54ch] items-start gap-1.5 text-[11px] leading-[1.45] text-muted-foreground">
            <Mail className="mt-px size-3.5 shrink-0" strokeWidth={1.75} />
            Connect Resend in Profile to send from your own address. You can still
            draft and save the email here.
          </p>
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 bg-card max-sm:h-11"
            onClick={openProfile}
          >
            Open Profile
          </Button>
        </div>
      ) : null}

      {error || notice ? (
        <p
          role={error ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[11px] leading-[1.45] ${
            error
              ? 'border-border/70 bg-muted/30 text-muted-foreground'
              : 'border-success/20 bg-success/5 text-success'
          }`}
        >
          {error ? (
            <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <Check className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          )}
          {error || notice}
        </p>
      ) : null}

      <div className="paper-shadow mx-auto mt-4 w-full max-w-[660px] bg-white px-6 py-6 ring-1 ring-black/[0.04] sm:px-9 sm:py-8">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              From
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-ink">
              {from || 'No sending address connected'}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium ${
              connected
                ? 'bg-success/10 text-success'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {connected ? 'Resend connected' : 'Resend not connected'}
          </span>
        </div>

        <label className="flex items-center gap-3 border-b border-border/70 py-2.5">
          <span className="w-14 shrink-0 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            To
          </span>
          <Input
            type="email"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="hiring@company.com"
            autoComplete="off"
            readOnly={locked}
            className="h-7 rounded-none border-0 bg-transparent px-0 text-[12px]"
          />
          {applicationEmail && to.trim().toLowerCase() === applicationEmail ? (
            <span className="shrink-0 text-[9px] text-success">From posting</span>
          ) : null}
        </label>

        <label className="flex items-center gap-3 border-b border-border/70 py-2.5">
          <span className="w-14 shrink-0 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Subject
          </span>
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Application for Senior Frontend Engineer"
            readOnly={locked}
            className="h-7 rounded-none border-0 bg-transparent px-0 text-[12px]"
          />
        </label>

        <textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value)
            if (notice) setNotice('')
          }}
          aria-label="Email body"
          spellCheck
          readOnly={locked}
          placeholder="Write the note, or draft it from the posting."
          className="mt-4 min-h-[300px] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[12.5px] leading-[1.7] text-ink outline-none transition-colors placeholder:text-muted-foreground [field-sizing:content] focus-visible:bg-brand-50/25 focus-visible:ring-0"
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground max-sm:min-h-11">
            <input
              type="checkbox"
              checked={attachCv}
              onChange={(event) => setAttachCv(event.target.checked)}
              disabled={locked}
              className="size-3.5 rounded border-border accent-brand-600"
            />
            <Paperclip className="size-3.5" strokeWidth={1.75} />
            Attach {application.cv.fileName.replace(/\.docx$/i, '.pdf')}
          </label>

          {locked ? (
            <span className="text-[10px] text-muted-foreground">
              {application.sentAt ? 'Sent' : 'Completed'} · downloads remain available
            </span>
          ) : connected ? (
            <Button
              size="sm"
              className="max-sm:h-11"
              onClick={() => setConfirmSend(true)}
              disabled={!canSend || busy !== null}
            >
              {busy === 'send' ? <LoaderCircle className="animate-spin" /> : <Send />}
              {busy === 'send' ? 'Sending…' : 'Send application'}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="bg-card max-sm:h-11" onClick={openProfile}>
              Set up sending
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] text-muted-foreground">
          {application.emailDraft
            ? `Saved draft${dirty ? ' · unsaved changes' : ''}`
            : 'No draft saved yet'}
        </p>
        {application.sentAt ? (
          <p className="text-[10px] tabular-nums text-success">
            Sent {formatDateTime(application.sentAt)} to {application.sentTo}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmGenerate}
        title="Replace the email draft?"
        description="Generating again will replace the current subject and body. Save them first if you want to keep them."
        confirmLabel="Generate again"
        busy={busy === 'generate'}
        onConfirm={() => void generate()}
        onClose={() => {
          if (busy !== 'generate') setConfirmGenerate(false)
        }}
      />

      <ConfirmDialog
        open={confirmSend}
        title={`Send application to ${to || 'this recipient'}?`}
        description="Resend will send the email from your connected address. This cannot be undone."
        confirmLabel={busy === 'send' ? 'Sending…' : 'Send application'}
        busy={busy === 'send'}
        onConfirm={() => void send()}
        onClose={() => {
          if (busy !== 'send') setConfirmSend(false)
        }}
      >
        <span className="block space-y-1">
          <span className="block">
            <span className="text-muted-foreground">From: </span>
            {from || 'Not connected'}
          </span>
          <span className="block">
            <span className="text-muted-foreground">Subject: </span>
            {subject || 'No subject'}
          </span>
          <span className="block">
            <span className="text-muted-foreground">Attachment: </span>
            {attachCv ? application.cv.fileName.replace(/\.docx$/i, '.pdf') : 'None'}
          </span>
        </span>
      </ConfirmDialog>
    </div>
  )
}
