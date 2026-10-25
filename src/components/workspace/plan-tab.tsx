import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/section'
import type { Score } from '@/lib/match'
import type { ApplicationDetail } from '@shared/account'
import type { CvStory } from '@shared/cv-fit'
import {
  DOMAIN_LABELS,
  SECTOR_LABELS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
} from '@shared/jd-classification'
import {
  ArrowRight,
  Check,
  FileText,
  Mail,
  PenLine,
  Sparkles,
} from 'lucide-react'
import type { WorkspaceTab } from './types'

type PlanTabProps = {
  application: ApplicationDetail
  score: Score | null
  stories: CvStory[]
  applicationEmail: string | null
  locked: boolean
  onOpenTab: (tab: WorkspaceTab) => void
  onTailorCv: () => void
  onOpenProfile: () => void
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[11.5px] leading-[1.4] text-ink">{value}</dd>
    </div>
  )
}

type Step = {
  label: string
  hint: string
  state: 'done' | 'current' | 'todo'
  actionLabel?: string
  onAction?: () => void
}

function NextSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-3 space-y-1">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums ${
                step.state === 'done'
                  ? 'bg-success/10 text-success'
                  : step.state === 'current'
                    ? 'bg-brand-600 text-white'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {step.state === 'done' ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : (
                index + 1
              )}
            </span>
            <div className="min-w-0">
              <p
                className={`text-[12px] font-medium ${
                  step.state === 'todo' ? 'text-muted-foreground' : 'text-ink'
                }`}
              >
                {step.label}
              </p>
              <p className="mt-0.5 text-[10.5px] leading-[1.45] text-muted-foreground">
                {step.hint}
              </p>
            </div>
          </div>
          {step.state === 'current' && step.actionLabel && step.onAction ? (
            <Button
              size="xs"
              className="shrink-0 max-sm:h-11"
              onClick={step.onAction}
            >
              {step.actionLabel}
            </Button>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function PackageRow({
  icon,
  label,
  status,
  action,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  status: string
  action: string
  onClick: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/25 text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-ink">{label}</p>
          <p className="text-[10px] text-muted-foreground">{status}</p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-muted-foreground hover:text-ink max-sm:h-11"
        onClick={onClick}
      >
        {action}
        <ArrowRight />
      </Button>
    </div>
  )
}

export function PlanTab({
  application,
  score,
  stories,
  applicationEmail,
  locked,
  onOpenTab,
  onTailorCv,
  onOpenProfile,
}: PlanTabProps) {
  const jd = application.classification?.data ?? null
  const gaps = score?.gaps ?? []
  const related = score?.related ?? []
  const sent = Boolean(application.sentAt)
  const finished = Boolean(application.sentAt || application.completedAt)

  const classified = Boolean(application.classification)
  const tailored = application.status === 'customized'
  const covered = classified && score?.coverage !== null && gaps.length === 0

  const steps: Step[] = [
    {
      label: 'Read the posting',
      hint: classified
        ? 'Posting read. The match below follows it.'
        : 'Paste the posting in the panel on the right.',
      state: classified ? 'done' : 'current',
    },
    {
      label: 'Tailor the CV',
      hint: tailored
        ? 'CV tailored to this posting.'
        : covered
          ? 'Every must-have is already covered.'
          : 'Tell Caddie what you have done; it proposes small CV edits.',
      state: tailored || covered ? 'done' : classified ? 'current' : 'todo',
      actionLabel: 'Tailor CV',
      onAction: onTailorCv,
    },
    {
      label: 'Draft the letter',
      hint: application.hasCoverLetter
        ? 'Letter drafted. You can still edit every line.'
        : 'A letter grounded in your CV and experience.',
      state: application.hasCoverLetter
        ? 'done'
        : classified
          ? 'current'
          : 'todo',
      actionLabel: 'Open letter',
      onAction: () => onOpenTab('letter'),
    },
    {
      label: 'Draft the email',
      hint: application.hasEmailDraft
        ? 'Email drafted.'
        : 'The short note that carries the CV.',
      state: application.hasEmailDraft
        ? 'done'
        : classified
          ? 'current'
          : 'todo',
      actionLabel: 'Open email',
      onAction: () => onOpenTab('email'),
    },
    {
      label: 'Send or mark done',
      hint: application.sentAt
        ? `Sent${application.sentTo ? ` to ${application.sentTo}` : ''}.`
        : application.completedAt
          ? 'Marked done without sending.'
          : 'Send from your own address, or mark the application done.',
      state: finished ? 'done' : classified ? 'current' : 'todo',
      actionLabel: 'Open email',
      onAction: () => onOpenTab('email'),
    },
  ]

  const currentIndex = steps.findIndex((step) => step.state === 'current')
  const ordered = steps.map((step, index) => ({
    ...step,
    state:
      step.state === 'current' && index !== currentIndex ? 'todo' : step.state,
  }))

  const work = jd
    ? [
        WORK_MODE_LABELS[jd.work.mode],
        jd.work.location,
        jd.work.employment,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <section className="p-5">
        <Eyebrow>Next steps</Eyebrow>
        <NextSteps steps={ordered} />
      </section>

      <section className="border-t border-border/70 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Match</Eyebrow>
            {jd ? (
              <p className="mt-2 max-w-[50ch] text-[12.5px] leading-[1.55] text-ink">
                {jd.summary}
              </p>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                The posting has not been read yet. Read it in the posting panel to score the CV.
              </p>
            )}
          </div>
          {score && score.coverage !== null ? (
            <div className="shrink-0 text-right">
              <p className="text-[30px] leading-none font-semibold tracking-[-0.04em] tabular-nums text-ink">
                {score.coverage}%
              </p>
              <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                {score.matched} of {score.total} must-haves
              </p>
            </div>
          ) : null}
        </div>

        {score && score.coverage !== null ? (
          <>
            <div
              className="mt-4 h-1.5 overflow-hidden rounded-full bg-brand-100"
              role="progressbar"
              aria-valuenow={score.coverage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Posting coverage against the CV"
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-200 ease-out"
                style={{ width: `${score.coverage}%` }}
              />
            </div>

            {gaps.length > 0 ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <Eyebrow>Must-haves to address</Eyebrow>
                  {locked ? (
                    <span className="text-[10px] text-muted-foreground">Locked</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
                      className="bg-card text-muted-foreground hover:text-ink max-sm:h-11"
                      onClick={onTailorCv}
                    >
                      <Sparkles />
                      Tailor CV
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {gaps.slice(0, 8).map((gap) => (
                    <span
                      key={gap.key}
                      className="rounded-md border border-mark-line/60 bg-mark/50 px-1.5 py-[1px] text-[10.5px] font-medium text-mark-foreground"
                    >
                      {gap.term}
                    </span>
                  ))}
                  {gaps.length > 8 ? (
                    <span className="px-1.5 py-[1px] text-[10.5px] text-muted-foreground">
                      +{gaps.length - 8} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-success">
                Every must-have is covered by this CV.
              </p>
            )}

            {related.length > 0 ? (
              <div className="mt-3">
                <Eyebrow>Worth showing</Eyebrow>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {related.slice(0, 6).map((item) => (
                    <span
                      key={item.key}
                      className="rounded-md border border-related-line/70 bg-related/60 px-1.5 py-[1px] text-[10.5px] text-related-foreground"
                    >
                      {item.term}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="border-t border-border/70 p-5">
        <Eyebrow>Documents</Eyebrow>
        <div className="mt-1 divide-y divide-border/60">
          <PackageRow
            icon={<FileText className="size-3.5" strokeWidth={1.75} />}
            label="CV"
            status={
              application.status === 'customized'
                ? 'Tailored to this posting'
                : 'Base CV snapshot'
            }
            action={application.status === 'customized' ? 'View CV' : 'Open CV'}
            onClick={() => onOpenTab('cv')}
          />
          <PackageRow
            icon={<PenLine className="size-3.5" strokeWidth={1.75} />}
            label="Letter"
            status={application.hasCoverLetter ? 'Drafted' : 'Not started'}
            action={application.hasCoverLetter || locked ? 'View' : 'Draft'}
            onClick={() => onOpenTab('letter')}
          />
          <PackageRow
            icon={<Mail className="size-3.5" strokeWidth={1.75} />}
            label="Email"
            status={
              sent
                ? `Sent ${application.sentTo ?? ''}`
                : application.hasEmailDraft
                  ? 'Drafted'
                  : 'Not started'
            }
            action={sent || application.hasEmailDraft || locked ? 'View' : 'Draft'}
            onClick={() => onOpenTab('email')}
          />
        </div>
      </section>

      {jd ? (
        <section className="border-t border-border/70 p-5">
          <Eyebrow>The brief</Eyebrow>
          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
            <Fact label="Work" value={work || 'Not stated'} />
            <Fact
              label="Compensation"
              value={
                [jd.compensation.salary, jd.compensation.equity ? 'Equity' : null]
                  .filter(Boolean)
                  .join(' · ') || 'Not stated'
              }
            />
            <Fact
              label="Seniority"
              value={SENIORITY_LABELS[jd.role.seniority]}
            />
            <Fact
              label="Company"
              value={
                jd.company.sectors.length > 0
                  ? jd.company.sectors.map((sector) => SECTOR_LABELS[sector]).join(' · ')
                  : DOMAIN_LABELS[jd.company.domain]
              }
            />
            <Fact
              label="Role area"
              value={jd.role.fields.length > 0 ? jd.role.fields.join(' · ') : 'Not stated'}
            />
            <Fact
              label="Employment"
              value={jd.work.employment || 'Not stated'}
            />
            {applicationEmail ? (
              <Fact label="Apply to" value={applicationEmail} />
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="border-t border-border/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Experience</Eyebrow>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-ink max-sm:h-11"
            onClick={onOpenProfile}
          >
            Manage
            <ArrowRight />
          </Button>
        </div>

        {stories.length === 0 ? (
          <div className="mt-3 flex items-start justify-between gap-4 rounded-lg border border-dashed border-border bg-muted/15 px-3 py-3">
            <p className="max-w-[48ch] text-[11px] leading-[1.5] text-muted-foreground">
              Add the work behind the CV. Caddie can use it in the letter and
              email without asking again.
            </p>
            <Button variant="outline" size="xs" className="shrink-0 bg-card max-sm:h-11" onClick={onOpenProfile}>
              Add experience
            </Button>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border/60">
            {stories.slice(0, 3).map((story) => (
              <li key={story.id} className="py-2.5 first:pt-0 last:pb-0">
                <p className="text-[11.5px] font-medium text-ink">
                  {story.title || 'Experience'}
                  {story.company ? (
                    <span className="font-normal text-muted-foreground">
                      {' '}· {story.company}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-[1.5] text-muted-foreground">
                  {story.userText}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
