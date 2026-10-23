import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  CATEGORY_LABELS,
  DOMAIN_LABELS,
  FAMILY_LABELS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
  type ClassificationResult,
  type Requirement,
} from '@shared/jd-classification'
import { AlertCircle, Braces, Check, Copy, LoaderCircle, RefreshCw } from 'lucide-react'

export type ClassifyStatus = 'idle' | 'loading' | 'error' | 'ready'

type JdDataProps = {
  status: ClassifyStatus
  result: ClassificationResult | null
  error: string
  onRun: () => void
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </p>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-brand-100 bg-brand-50 px-1.5 py-[2px] text-[10.5px] font-medium text-brand-700">
      {children}
    </span>
  )
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
      <dd
        className={
          value
            ? 'mt-0.5 truncate text-[11.5px] font-medium text-ink'
            : 'mt-0.5 truncate text-[11.5px] text-muted-foreground'
        }
        title={value ?? undefined}
      >
        {value ?? 'Not stated'}
      </dd>
    </div>
  )
}

function RequirementList({ items }: { items: Requirement[] }) {
  if (items.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground">None extracted.</p>
  }

  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
      {items.map((item, index) => (
        <li
          key={`${item.label}-${index}`}
          className="flex items-start justify-between gap-3 px-2.5 py-1.5"
          title={item.evidence || undefined}
        >
          <span className="min-w-0 text-[11.5px] leading-[1.4] text-ink">{item.label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {item.years !== null ? (
              <span className="rounded-[4px] bg-muted px-1 py-px text-[10px] tabular-nums text-muted-foreground">
                {item.years} yrs
              </span>
            ) : null}
            <span className="text-[10px] text-muted-foreground">
              {CATEGORY_LABELS[item.category]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function DataEmpty({ onRun }: { onRun: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
        <Braces className="size-5" strokeWidth={1.75} />
      </div>
      <p className="mt-3 text-[13px] font-medium text-ink">Read the posting as data</p>
      <p className="mt-1 max-w-[34ch] text-[12px] leading-[1.5] text-muted-foreground">
        Extract the role, company, requirements and terms into a structured object.
      </p>
      <Button className="mt-4 max-sm:h-11" onClick={onRun}>
        Read with Gemma
      </Button>
      <p className="mt-2 max-w-[32ch] text-[10.5px] leading-[1.4] text-muted-foreground">
        Sends this posting to Cloudflare for classification. Usually takes 20–40 seconds.
      </p>
    </div>
  )
}

function DataLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <LoaderCircle className="size-5 animate-spin text-brand-600" strokeWidth={1.75} />
      <p className="mt-3 text-[13px] font-medium text-ink">Reading the posting</p>
      <p className="mt-1 max-w-[34ch] text-[12px] leading-[1.5] text-muted-foreground">
        Pulling out the role, requirements and terms. This can take up to a minute.
      </p>
      <div className="mt-5 w-full max-w-[240px] space-y-2" aria-hidden="true">
        <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
        <div className="h-2 w-4/5 animate-pulse rounded-full bg-muted" />
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-muted" />
      </div>
    </div>
  )
}

function DataError({
  message,
  onRun,
}: {
  message: string
  onRun: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground">
        <AlertCircle className="size-5" strokeWidth={1.75} />
      </div>
      <p className="mt-3 text-[13px] font-medium text-ink">Could not read this posting</p>
      <p className="mt-1 max-w-[38ch] text-[12px] leading-[1.5] text-muted-foreground">
        {message}
      </p>
      <Button variant="outline" className="mt-4 max-sm:h-11" onClick={onRun}>
        Try again
      </Button>
    </div>
  )
}

function DataBody({ result, onRun }: { result: ClassificationResult; onRun: () => void }) {
  const { data, meta } = result
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const musts = data.requirements.filter((item) => item.importance === 'must')
  const nices = data.requirements.filter((item) => item.importance === 'nice')

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const seconds = (meta.latencyMs / 1000).toFixed(1)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Read from the posting</Eyebrow>
          <h3 className="mt-1 text-[14px] leading-[1.3] font-semibold tracking-[-0.015em] text-ink">
            {data.role.title || 'Untitled role'}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {[data.company.name, data.work.location].filter(Boolean).join(' · ') ||
              'Company not stated'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-ink max-sm:size-11"
            onClick={onRun}
            aria-label="Read the posting again"
            title="Read the posting again"
          >
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-ink max-sm:h-11"
            onClick={() => void copyJson()}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'JSON'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Chip>{FAMILY_LABELS[data.role.family]}</Chip>
        <Chip>{SENIORITY_LABELS[data.role.seniority]}</Chip>
        <Chip>{WORK_MODE_LABELS[data.work.mode]}</Chip>
        {data.company.domain === 'unspecified' ? null : (
          <Chip>{DOMAIN_LABELS[data.company.domain]}</Chip>
        )}
      </div>

      {data.summary ? (
        <p className="max-w-[65ch] text-[12px] leading-[1.55] text-[#2a3446]">
          {data.summary}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Fact label="Work mode" value={WORK_MODE_LABELS[data.work.mode]} />
        <Fact label="Employment" value={data.work.employment} />
        <Fact label="Location" value={data.work.location} />
        <Fact label="Timezone" value={data.work.timezone} />
        <Fact label="Salary" value={data.compensation.salary} />
        <Fact
          label="Equity"
          value={
            data.compensation.equity === null
              ? null
              : data.compensation.equity
                ? 'Offered'
                : 'Not offered'
          }
        />
      </dl>

      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Eyebrow>Must have</Eyebrow>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {musts.length}
          </span>
        </div>
        <RequirementList items={musts} />
      </section>

      {nices.length > 0 ? (
        <section className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Eyebrow>Nice to have</Eyebrow>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {nices.length}
            </span>
          </div>
          <RequirementList items={nices} />
        </section>
      ) : null}

      {data.responsibilities.length > 0 ? (
        <section className="space-y-1.5">
          <Eyebrow>Responsibilities</Eyebrow>
          <ul className="space-y-0.5">
            {data.responsibilities.map((item) => (
              <li key={item} className="flex gap-1.5 text-[11.5px] leading-[1.5] text-ink">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-400" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.benefits.length > 0 ? (
        <section className="space-y-1.5">
          <Eyebrow>Benefits</Eyebrow>
          <ul className="space-y-0.5">
            {data.benefits.map((item) => (
              <li key={item} className="flex gap-1.5 text-[11.5px] leading-[1.5] text-ink">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-400" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.keywords.length > 0 ? (
        <section className="space-y-1.5">
          <Eyebrow>Terms</Eyebrow>
          <div className="flex flex-wrap gap-1">
            {data.keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-md bg-muted px-1.5 py-[2px] text-[10.5px] text-muted-foreground"
              >
                {keyword}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <p className="border-t border-border/60 pt-2.5 text-[10px] text-muted-foreground">
        Gemma · {seconds}s
        {meta.attempts > 1 ? ` · ${meta.attempts} calls` : ''}
      </p>
    </div>
  )
}

export function JdData({ status, result, error, onRun }: JdDataProps) {
  if (status === 'loading') return <DataLoading />
  if (status === 'error') return <DataError message={error} onRun={onRun} />
  if (status === 'ready' && result) return <DataBody result={result} onRun={onRun} />
  return <DataEmpty onRun={onRun} />
}
