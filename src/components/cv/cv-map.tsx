import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { auditCv } from '@shared/cv-audit'
import type { CvClassification } from '@shared/cv-classification'
import { buildCvMap, cvMapTargets, type CvMap, type CvMapTarget } from '@shared/cv-map'
import type { JdClassification } from '@shared/jd-classification'
import { cn } from 'cn'
import { FileQuestion, ListTree, X } from 'lucide-react'

type CvMapDrawerProps = {
  open: boolean
  cv: CvClassification | null
  jd: JdClassification | null
  onClose: () => void
}

function targetStatus(target: CvMapTarget, audit: ReturnType<typeof auditCv> | null) {
  if (!target.blockId) return { label: 'No anchor', className: 'bg-muted text-muted-foreground' }
  if (!target.wholeBlock) {
    return { label: 'Partial block', className: 'bg-muted text-muted-foreground' }
  }
  const entry = audit?.targets.find((item) => item.target.blockId === target.blockId)
  if (!entry) return { label: 'Not scored', className: 'bg-muted text-muted-foreground' }
  if (entry.protected) return { label: 'Protect', className: 'bg-success/10 text-success' }
  if (entry.related) return { label: 'Worth showing', className: 'bg-related/70 text-related-foreground' }
  if (entry.generic) return { label: 'Generic', className: 'bg-muted text-muted-foreground' }
  return { label: 'Safe to swap', className: 'bg-brand-50 text-brand-700' }
}

function TargetRow({
  target,
  audit,
  nested,
}: {
  target: CvMapTarget
  audit: ReturnType<typeof auditCv> | null
  nested?: boolean
}) {
  const status = targetStatus(target, audit)
  return (
    <li className={cn('flex items-start gap-2', nested ? 'ml-3' : '')}>
      <span className="mt-[6px] size-1 shrink-0 rounded-full bg-brand-300" />
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-[1.45] text-ink">{target.text}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={cn('rounded px-1 py-0.5 text-[9px] font-medium', status.className)}>
            {status.label}
          </span>
          <span className="text-[9px] text-muted-foreground">
            {target.blockId ?? 'unanchored'} · {target.kind}
          </span>
        </div>
      </div>
    </li>
  )
}

function ProjectBlock({
  project,
  audit,
}: {
  project: CvMap['roles'][number]['projects'][number]
  audit: ReturnType<typeof auditCv> | null
}) {
  return (
    <div className="ml-4 mt-3 border-l border-border/70 pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="text-[11.5px] font-semibold text-ink">{project.name ?? 'Untitled project'}</p>
        <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
          {project.kind}
        </span>
        {project.product ? (
          <span className="text-[9.5px] text-muted-foreground">{project.product}</span>
        ) : null}
      </div>
      {project.descriptionTarget ? (
        <ul className="mt-1.5 space-y-1.5">
          <TargetRow target={project.descriptionTarget} audit={audit} />
          {project.bullets.map((target) => (
            <TargetRow key={target.id} target={target} audit={audit} nested />
          ))}
        </ul>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {project.bullets.map((target) => (
            <TargetRow key={target.id} target={target} audit={audit} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function CvMapDrawer({ open, cv, jd, onClose }: CvMapDrawerProps) {
  const map = useMemo(() => (cv ? buildCvMap(cv) : null), [cv])
  const audit = useMemo(
    () => (map && jd ? auditCv(map, jd.requirements) : null),
    [map, jd],
  )

  if (!open) return null

  const targets = map ? cvMapTargets(map) : []
  const projectCount =
    (map?.roles.reduce((total, role) => total + role.projects.length, 0) ?? 0) +
    (map?.orphanProjects.length ?? 0)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="CV map"
        className="drawer-shadow fixed inset-y-0 right-0 z-50 flex w-full max-w-[540px] flex-col border-l border-border bg-card"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-brand-600">
              <ListTree className="size-4" strokeWidth={1.75} />
              <p className="text-[10px] font-semibold tracking-[0.12em] uppercase">CV map</p>
            </div>
            <h2 className="mt-1.5 text-[15px] leading-none font-semibold tracking-[-0.015em] text-ink">
              What Caddie found
            </h2>
            <p className="mt-1.5 max-w-[40ch] text-[11.5px] leading-[1.45] text-muted-foreground">
              Roles, projects and the blocks that are safe to change. Protect marks
              evidence that is carrying a must-have.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-ink"
            onClick={onClose}
            aria-label="Close CV map"
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {!map ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <FileQuestion className="size-5 text-muted-foreground" strokeWidth={1.75} />
              <p className="mt-3 text-[13px] font-medium text-ink">Read the CV first</p>
              <p className="mt-1 max-w-[34ch] text-[11.5px] leading-[1.5] text-muted-foreground">
                The map appears after Caddie has read the roles and projects.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Roles" value={map.roles.length} />
                <Stat label="Projects" value={projectCount} />
                <Stat label="Targets" value={targets.filter((target) => target.blockId && target.wholeBlock).length} />
              </div>

              <div className="space-y-4">
                {map.roles.map((role) => (
                  <section key={role.id} className="rounded-lg border border-border/70 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-[12px] font-semibold text-ink">
                          {role.title ?? 'Untitled role'}
                        </p>
                        <p className="text-[10.5px] text-muted-foreground">
                          {[role.company, role.location, role.dates].filter(Boolean).join(' · ') || 'No company or dates'}
                        </p>
                      </div>
                      <span className="text-[9px] text-muted-foreground">{role.id}</span>
                    </div>
                    {role.bullets.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {role.bullets.map((target) => (
                          <TargetRow key={target.id} target={target} audit={audit} />
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[10.5px] text-muted-foreground">No role bullets.</p>
                    )}
                    {role.projects.map((project) => (
                      <ProjectBlock key={project.id} project={project} audit={audit} />
                    ))}
                  </section>
                ))}

                {map.orphanProjects.length > 0 ? (
                  <section className="rounded-lg border border-border/70 p-3">
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                      Projects without a role
                    </p>
                    {map.orphanProjects.map((project) => (
                      <ProjectBlock key={project.id} project={project} audit={audit} />
                    ))}
                  </section>
                ) : null}
              </div>

              {targets.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] leading-[1.45] text-muted-foreground">
                  No editable role or project blocks were found. Try a deep read, or
                  use a DOCX with anchored bullets.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
      <p className="text-[18px] leading-none font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[9.5px] text-muted-foreground">{label}</p>
    </div>
  )
}
