import { useState } from 'react'
import type { AccountMe, PublicWorkSource } from '@shared/account'
import {
  AlertCircle,
  Check,
  ExternalLink,
  GitFork,
  Globe2,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { savePublicWork } from '@/lib/account'

const dateFormat = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </p>
  )
}

function SourceIcon({ kind }: { kind: PublicWorkSource['kind'] }) {
  return kind === 'github' ? (
    <GitFork className="size-4" strokeWidth={1.75} />
  ) : (
    <Globe2 className="size-4" strokeWidth={1.75} />
  )
}

function ProjectRow({
  project,
}: {
  project: PublicWorkSource['projects'][number]
}) {
  return (
    <li className="border-t border-border/60 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-ink">{project.name}</p>
          {project.description ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.45] text-muted-foreground">
              {project.description}
            </p>
          ) : null}
          {project.skills.length > 0 ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {project.skills.join(' · ')}
            </p>
          ) : null}
        </div>
        {project.url ? (
          <a
            href={project.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${project.name}`}
            className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </a>
        ) : null}
      </div>
    </li>
  )
}

function SourceCard({ source }: { source: PublicWorkSource }) {
  const host = (() => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {
      return source.url
    }
  })()
  const title =
    source.label ||
    (source.kind === 'github' ? host.replace(/^github\.com\//, '@') : host)

  return (
    <div className="rounded-lg border border-border/70 bg-muted/15 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            <SourceIcon kind={source.kind} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-medium text-ink">{title}</p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {source.readAt ? `Read ${formatDate(source.readAt)}` : 'Not read yet'}
            </p>
          </div>
        </div>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${source.kind}`}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </a>
      </div>

      {source.error ? (
        <p
          role="status"
          className="mt-3 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[10.5px] leading-[1.45] text-muted-foreground"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          {source.error}
        </p>
      ) : null}

      {source.headline ? (
        <p className="mt-3 text-[11.5px] leading-[1.45] text-ink">{source.headline}</p>
      ) : null}
      {source.summary ? (
        <p className="mt-1 text-[11px] leading-[1.5] text-muted-foreground">
          {source.summary}
        </p>
      ) : null}

      {source.skills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {source.skills.slice(0, 10).map((skill) => (
            <span
              key={skill}
              className="rounded-md bg-card px-1.5 py-0.5 text-[9.5px] text-muted-foreground"
            >
              {skill}
            </span>
          ))}
        </div>
      ) : null}

      {source.projects.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Projects
          </p>
          <ul className="mt-1">
            {source.projects.slice(0, 4).map((project, index) => (
              <ProjectRow
                key={`${source.kind}-${index}-${project.name}`}
                project={project}
              />
            ))}
          </ul>
          {source.projects.length > 4 ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {source.projects.length - 4} more in the source.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function PublicWork({
  me,
  onRefreshMe,
}: {
  me: AccountMe
  onRefreshMe: () => Promise<void>
}) {
  const [website, setWebsite] = useState(me.publicWork.website?.url ?? '')
  const [github, setGithub] = useState(me.publicWork.github?.url ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const sources = [me.publicWork.website, me.publicWork.github].filter(
    (source): source is PublicWorkSource => Boolean(source),
  )
  const canRead = Boolean(website.trim() || github.trim())
  const canClear = Boolean(
    sources.length || website.trim() || github.trim(),
  )

  async function handleClear() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await savePublicWork({ website: null, github: null })
      setWebsite('')
      setGithub('')
      setNotice('Public work removed.')
      await onRefreshMe()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Those links could not be removed.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleRead() {
    if (!canRead) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await savePublicWork({
        website: website.trim() || null,
        github: github.trim() || null,
      })
      setWebsite(result.publicWork.website?.url ?? '')
      setGithub(result.publicWork.github?.url ?? '')
      setNotice('Public work saved.')
      await onRefreshMe()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Those links could not be read.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Public work</SectionLabel>
          <p className="mt-1 max-w-[52ch] text-[11.5px] leading-[1.45] text-muted-foreground">
            Add your site and GitHub so Caddie can find project evidence for
            drafts. Only public pages are read.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            Website
          </span>
          <Input
            value={website}
            onChange={(event) => {
              setWebsite(event.target.value)
              if (error) setError('')
            }}
            placeholder="yourname.com"
            inputMode="url"
            autoComplete="url"
            className="mt-1.5"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            GitHub
          </span>
          <Input
            value={github}
            onChange={(event) => {
              setGithub(event.target.value)
              if (error) setError('')
            }}
            placeholder="github.com/yourname"
            autoComplete="username"
            className="mt-1.5"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[46ch] text-[10px] leading-[1.45] text-muted-foreground">
          Website reading uses Browserbase; GitHub uses its public API. Neither
          gets your CV.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {canClear ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-ink max-sm:h-11"
              onClick={() => void handleClear()}
              disabled={busy}
            >
              Clear
            </Button>
          ) : null}
          <Button
            size="sm"
            className="max-sm:h-11"
            onClick={() => void handleRead()}
            disabled={busy || !canRead}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {busy ? 'Reading…' : 'Read links'}
          </Button>
        </div>
      </div>

      {notice || error ? (
        <p
          role={error ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] leading-[1.45] ${
            error
              ? 'border-border/70 bg-muted/40 text-muted-foreground'
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

      {sources.length > 0 ? (
        <div className="mt-4 grid gap-2.5">
          {sources.map((source) => (
            <SourceCard key={source.kind} source={source} />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/15 px-4 py-4">
          <p className="text-[11.5px] font-medium text-ink">No public work added yet.</p>
          <p className="mt-1 max-w-[48ch] text-[10.5px] leading-[1.45] text-muted-foreground">
            A portfolio or GitHub profile gives Caddie more concrete projects to
            draw on. You can still add experiences by hand.
          </p>
        </div>
      )}
    </section>
  )
}
