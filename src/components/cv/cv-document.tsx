import type { ReactNode } from 'react'

import type { CvProfile } from '@/data/cv'
import { A4 } from '@/lib/page'
import { cn } from 'cn'

const body = 'text-[#3b4557]'
const quiet = 'text-[#79839a]'

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-3">
      <h2 className="text-[9px] font-semibold tracking-[0.22em] text-brand-700 uppercase">
        {children}
      </h2>
      <span className="h-px flex-1 bg-[#e7ebf3]" />
    </div>
  )
}

function Section({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('mt-[30px]', className)}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  )
}

export function CvDocument({ profile }: { profile: CvProfile }) {
  return (
    <article
      className="flex h-full w-full flex-col bg-white px-[58px] py-[52px]"
      style={{ width: A4.width, height: A4.height }}
      aria-label={`${profile.name} — CV`}
    >
      <header>
        <h1 className="font-serif text-[42px] leading-[0.98] font-medium tracking-[-0.015em] text-ink">
          {profile.name}
        </h1>
        <p className="mt-3 text-[10px] font-semibold tracking-[0.22em] text-brand-700 uppercase">
          {profile.role}
        </p>
        <ul className={cn('mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9.5px]', quiet)}>
          {profile.contact.map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <span className="size-[2.5px] rounded-full bg-[#ccd3e0]" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-4 h-px w-full bg-[#e7ebf3]" />
      </header>

      <Section title="Profile">
        <p className={cn('text-[11px] leading-[1.65]', body)}>{profile.summary}</p>
      </Section>

      <Section title="Experience">
        <div className="space-y-[18px]">
          {profile.experience.map((job) => (
            <div key={`${job.company}-${job.role}`}>
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-[11.5px] leading-tight font-semibold tracking-[-0.005em] text-ink">
                  {job.company}
                  <span className={cn('font-normal', quiet)}> — {job.role}</span>
                </h3>
                <span className={cn('shrink-0 text-[9px] tabular-nums', quiet)}>
                  {job.period}
                </span>
              </div>
              <p className={cn('mt-0.5 text-[9px]', quiet)}>{job.location}</p>
              <ul className="mt-1.5 space-y-[5px]">
                {job.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className={cn('flex gap-2 text-[10.5px] leading-[1.6]', body)}
                  >
                    <span className="mt-[6px] size-[3px] shrink-0 rounded-full bg-brand-300" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Projects">
        <div className="space-y-[12px]">
          {profile.projects.map((project) => (
            <div key={project.name}>
              <h3 className="text-[11px] font-semibold text-ink">
                {project.name}
                <span className={cn('ml-1.5 font-normal', quiet)}>
                  {project.tech}
                </span>
              </h3>
              <p className={cn('mt-0.5 text-[10.5px] leading-[1.6]', body)}>
                {project.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Education">
        <div className="space-y-1">
          {profile.education.map((entry) => (
            <div key={entry.school} className="flex items-baseline justify-between gap-4">
              <h3 className="text-[11px] text-ink">
                <span className="font-semibold">{entry.school}</span>
                <span className={quiet}> — {entry.degree}</span>
              </h3>
              <span className={cn('shrink-0 text-[9px] tabular-nums', quiet)}>
                {entry.period}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Skills">
        <div className="grid grid-cols-[82px_1fr] gap-x-3 gap-y-[6px]">
          {profile.skillGroups.map((group) => (
            <div key={group.label} className="contents">
              <span className={cn('text-[9px] font-semibold tracking-[0.1em] uppercase', quiet)}>
                {group.label}
              </span>
              <span className={cn('text-[10.5px] leading-[1.4]', body)}>
                {group.items}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Languages">
        <p className={cn('text-[10.5px]', body)}>{profile.languages}</p>
      </Section>
    </article>
  )
}
