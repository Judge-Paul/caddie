import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'

import { JdPanel } from '@/components/jd/jd-panel'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CvMapDrawer } from '@/components/cv/cv-map'
import { CoverLetterTab } from '@/components/workspace/cover-letter-tab'
import { EmailTab } from '@/components/workspace/email-tab'
import { PlanTab } from '@/components/workspace/plan-tab'
import type { WorkspaceTab } from '@/components/workspace/types'
import {
  applicationStage,
  STAGE_LABELS,
  stageClass,
  stageDot,
} from '@/lib/application-stage'
import { completeApplication, downloadApplicationFile, getApplicationFile } from '@/lib/account'
import { DOCX_MIME, classifyCvDocx, editCvDocx } from '@/lib/docx'
import { scoreRequirements } from '@/lib/match'
import type { CvPdf } from '@/lib/pdf'
import type {
  ApplicationDetail,
  SendingSettings,
  UpdateApplicationPatch,
} from '@shared/account'
import type { CvClassification } from '@shared/cv-classification'
import type { CvStory } from '@shared/cv-fit'
import type { ClassificationResult } from '@shared/jd-classification'
import { findApplicationEmail } from '@shared/application-email'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  ListChecks,
  LoaderCircle,
  ListTree,
  LockKeyhole,
  Mail,
  PenLine,
  Sparkles,
} from 'lucide-react'

const PdfPreview = lazy(() =>
  import('@/components/cv/pdf-preview').then((module) => ({
    default: module.PdfPreview,
  })),
)

type WorkspaceProps = {
  application: ApplicationDetail
  stories: CvStory[]
  sending: SendingSettings
  onBack: () => void
  onOpenProfile: () => void
  onUpdateApplication: (patch: UpdateApplicationPatch) => Promise<void>
  onApplicationUpdated: (application: ApplicationDetail) => void
  onSaveCv: (docx: Blob, pdf: Blob) => Promise<void>
  onSaveStory: (story: CvStory) => void
}

function PaperPlaceholder({ label }: { label?: string }) {
  return (
    <div className="paper-shadow flex aspect-[794/1123] w-full items-center justify-center bg-white ring-1 ring-black/[0.04]">
      {label ? (
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
          {label}
        </span>
      ) : null}
    </div>
  )
}

const TABS: { id: WorkspaceTab; label: string; icon: typeof FileText }[] = [
  { id: 'plan', label: 'Plan', icon: ListChecks },
  { id: 'cv', label: 'CV', icon: FileText },
  { id: 'letter', label: 'Letter', icon: PenLine },
  { id: 'email', label: 'Email', icon: Mail },
]

export function Workspace({
  application,
  stories,
  sending,
  onBack,
  onOpenProfile,
  onUpdateApplication,
  onApplicationUpdated,
  onSaveCv,
  onSaveStory,
}: WorkspaceProps) {
  const paneRef = useRef<HTMLElement>(null)
  const jdTimerRef = useRef<number | null>(null)
  const cvRequestRef = useRef<AbortController | null>(null)

  const [tab, setTab] = useState<WorkspaceTab>('plan')
  const [pdf, setPdf] = useState<CvPdf | null>(null)
  const [docx, setDocx] = useState<File | null>(null)
  const [uploadId, setUploadId] = useState(0)
  const [loadingCv, setLoadingCv] = useState(true)
  const [cvLoadError, setCvLoadError] = useState('')

  const [jd, setJd] = useState(application.jdText)
  const [jdError, setJdError] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [completeBusy, setCompleteBusy] = useState(false)
  const [completeError, setCompleteError] = useState('')
  const [downloadCvBusy, setDownloadCvBusy] = useState(false)
  const [downloadCvError, setDownloadCvError] = useState('')

  const [cvClassification, setCvClassification] =
    useState<CvClassification | null>(null)
  const [cvStatus, setCvStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  )
  const [cvReadError, setCvReadError] = useState('')
  const [cvNeedsDeepRead, setCvNeedsDeepRead] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const { loadCvPdf } = await import('@/lib/pdf')
        const pdfBlob = await getApplicationFile(application.id, 'pdf')
        const pdfFile = new File(
          [pdfBlob],
          application.cv.fileName.replace(/\.(docx|pdf)$/i, '.pdf'),
          { type: 'application/pdf' },
        )
        const next = await loadCvPdf(pdfFile)

        if (cancelled) {
          void next.doc.loadingTask.destroy().catch(() => {})
          return
        }

        setPdf(next)
        setUploadId((id) => id + 1)

        if (application.cv.hasDocx) {
          const docxBlob = await getApplicationFile(application.id, 'docx')
          if (!cancelled) {
            setDocx(
              new File([docxBlob], application.cv.fileName, {
                type: DOCX_MIME,
              }),
            )
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCvLoadError(
            error instanceof Error ? error.message : 'That CV could not be opened.',
          )
        }
      } finally {
        if (!cancelled) setLoadingCv(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [application.id, application.cv.fileName, application.cv.hasDocx])

  useEffect(
    () => () => {
      void pdf?.doc.loadingTask.destroy().catch(() => {})
    },
    [pdf],
  )

  useEffect(
    () => () => {
      if (jdTimerRef.current) window.clearTimeout(jdTimerRef.current)
      cvRequestRef.current?.abort()
    },
    [],
  )

  const score = useMemo(
    () =>
      application.classification
        ? scoreRequirements(
            pdf?.text ?? '',
            jd,
            application.classification.data.requirements,
            application.classification.data.signals,
          )
        : null,
    [application.classification, jd, pdf?.text],
  )

  const stage = applicationStage(application)
  const locked = Boolean(application.sentAt || application.completedAt)
  const applicationEmail = useMemo(() => findApplicationEmail(jd), [jd])
  const canCompose = Boolean(
    application.classification && (pdf?.text.trim().length ?? 0) > 80,
  )

  function selectTab(next: WorkspaceTab) {
    setTab(next)
    if (next !== 'cv') {
      setAssistantOpen(false)
      setMapOpen(false)
    }
  }

  function handleJdChange(next: string) {
    setJd(next)
    setAssistantOpen(false)
    setJdError('')
    if (jdTimerRef.current) window.clearTimeout(jdTimerRef.current)
    jdTimerRef.current = window.setTimeout(() => {
      void onUpdateApplication({ jdText: next }).catch((error) => {
        setJdError(
          error instanceof Error ? error.message : 'The posting could not be saved.',
        )
      })
    }, 900)
  }

  function handleClassified(result: ClassificationResult) {
    void onUpdateApplication({ classification: result, status: 'classified' }).catch(
      (error) => {
        setJdError(
          error instanceof Error ? error.message : 'The posting could not be saved.',
        )
      },
    )
  }

  async function runCvClassify(mode: 'fast' | 'deep') {
    if (!docx || cvStatus === 'loading') return
    if (mode === 'fast' && cvClassification) return

    cvRequestRef.current?.abort()
    const controller = new AbortController()
    cvRequestRef.current = controller
    setCvStatus('loading')
    setCvReadError('')

    try {
      const result = await classifyCvDocx(docx, controller.signal, mode)
      if (controller.signal.aborted) return
      setCvClassification(result.data)
      setCvNeedsDeepRead(
        mode === 'deep' ? false : Boolean(result.meta.needsDeepRead),
      )
      setCvStatus('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setCvReadError(
        error instanceof Error ? error.message : 'That CV could not be read.',
      )
      setCvStatus(mode === 'deep' && cvClassification ? 'ready' : 'error')
    } finally {
      if (cvRequestRef.current === controller) cvRequestRef.current = null
    }
  }

  async function applyCvEdits(edits: { blockId: string; text: string }[]) {
    if (!docx) throw new Error('Upload a DOCX to edit this CV.')
    if (edits.length === 0) return

    const result = await editCvDocx(docx, edits)
    await onSaveCv(result.docx, result.pdf)

    const { loadCvPdf } = await import('@/lib/pdf')
    const source = new File([result.docx], docx.name, { type: DOCX_MIME })
    const rendered = new File(
      [result.pdf],
      docx.name.replace(/\.docx$/i, '.pdf'),
      { type: 'application/pdf' },
    )
    const next = await loadCvPdf(rendered)

    setPdf(next)
    setDocx(source)
    setUploadId((id) => id + 1)
    const byBlock = new Map(edits.map((edit) => [edit.blockId, edit.text]))
    setCvClassification((current) => {
      if (!current) return current
      return {
        ...current,
        roles: current.roles.map((role) => ({
          ...role,
          bullets: role.bullets.map((bullet) =>
            bullet.anchor?.blockId && byBlock.has(bullet.anchor.blockId)
              ? { ...bullet, text: byBlock.get(bullet.anchor.blockId)! }
              : bullet,
          ),
        })),
        projects: current.projects.map((project) => ({
          ...project,
          description:
            project.anchors.description?.blockId &&
            byBlock.has(project.anchors.description.blockId)
              ? byBlock.get(project.anchors.description.blockId)!
              : project.description,
          bullets: project.bullets.map((bullet) =>
            bullet.anchor?.blockId && byBlock.has(bullet.anchor.blockId)
              ? { ...bullet, text: byBlock.get(bullet.anchor.blockId)! }
              : bullet,
          ),
        })),
      }
    })
  }

  const pageLabel = pdf
    ? `${application.cv.kind === 'docx' ? 'DOCX' : 'PDF'} · ${pdf.pageCount} ${
        pdf.pageCount === 1 ? 'page' : 'pages'
      }`
    : 'A4'

  const nextAction = locked
    ? null
    : !application.classification
      ? null
      : !application.hasEmailDraft
        ? application.hasCoverLetter
          ? { label: 'Draft email', tab: 'email' as const }
          : { label: 'Draft letter', tab: 'letter' as const }
        : { label: 'Review & send', tab: 'email' as const }

  async function handleDownloadCv() {
    setDownloadCvBusy(true)
    setDownloadCvError('')
    try {
      await downloadApplicationFile(
        application.id,
        'pdf',
        application.cv.fileName.replace(/\.docx$/i, '.pdf'),
      )
    } catch (caught) {
      setDownloadCvError(
        caught instanceof Error ? caught.message : 'The CV could not be downloaded.',
      )
    } finally {
      setDownloadCvBusy(false)
    }
  }

  async function handleComplete() {
    setCompleteBusy(true)
    setCompleteError('')
    try {
      const updated = await completeApplication(application.id)
      onApplicationUpdated(updated)
      setAssistantOpen(false)
      setCompleteOpen(false)
    } catch (caught) {
      setCompleteOpen(false)
      setCompleteError(
        caught instanceof Error ? caught.message : 'The application could not be completed.',
      )
    } finally {
      setCompleteBusy(false)
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/70 bg-background/90">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-start gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ml-1 mt-0.5 shrink-0 text-muted-foreground hover:text-ink max-sm:size-11"
              onClick={onBack}
              aria-label="All applications"
              title="All applications"
            >
              <ArrowLeft />
            </Button>
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Application
              </p>
              <h1 className="mt-0.5 truncate text-[16px] leading-[1.2] font-semibold tracking-[-0.02em] text-ink">
                {application.title ?? 'Untitled application'}
              </h1>
              <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-muted-foreground">
                {application.company ?? 'Company not read yet'}
                <span className="size-0.5 rounded-full bg-muted-foreground/40" />
                <span className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9.5px] font-medium ${stageClass(stage)}`}>
                  <span className={`size-1.5 rounded-full ${stageDot(stage)}`} />
                  {STAGE_LABELS[stage]}
                </span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {nextAction ? (
              <Button
                size="sm"
                className="h-8 max-sm:h-11"
                onClick={() => selectTab(nextAction.tab)}
              >
                {nextAction.tab === 'email' ? <Mail /> : <PenLine />}
                {nextAction.label}
              </Button>
            ) : locked ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
                <CheckCircle2 className="size-3.5" strokeWidth={2} />
                {application.sentAt ? 'Application sent' : 'Application completed'}
              </span>
            ) : !application.classification ? (
              <span className="text-[11px] text-muted-foreground">Posting not read</span>
            ) : null}
            {!locked ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 bg-card text-muted-foreground hover:text-ink max-sm:h-11"
                onClick={() => setCompleteOpen(true)}
              >
                <CheckCircle2 />
                Mark complete
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <LockKeyhole className="size-3" strokeWidth={1.75} />
                CV and letter locked
              </span>
            )}
          </div>
        </div>
      </div>

      {completeError ? (
        <p
          role="alert"
          className="shrink-0 border-b border-border/70 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground sm:px-6"
        >
          {completeError}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(404px,460px)]">
        <section
          ref={paneRef}
          className="min-h-0 overflow-y-auto bg-canvas px-4 py-5 sm:px-8"
        >
          <div className="mx-auto w-full max-w-[760px]">
            <div
              className="mb-5 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="tablist"
              aria-label="Application package"
            >
              {TABS.map((entry) => {
                const Icon = entry.icon
                const active = tab === entry.id
                const complete =
                  (entry.id === 'letter' && application.hasCoverLetter) ||
                  (entry.id === 'email' && application.hasEmailDraft)

                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    id={`application-tab-${entry.id}`}
                    aria-selected={active}
                    aria-controls="application-tab-panel"
                    onClick={() => selectTab(entry.id)}
                    className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 max-sm:min-h-11 max-sm:px-3 text-[11.5px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                      active
                        ? 'border-brand-600 text-ink'
                        : 'border-transparent text-muted-foreground hover:text-ink'
                    }`}
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                    {entry.label}
                    {complete ? (
                      <span className="size-1.5 rounded-full bg-success" aria-label="Drafted" />
                    ) : null}
                  </button>
                )
              })}
            </div>

            <div
              id="application-tab-panel"
              role="tabpanel"
              aria-labelledby={`application-tab-${tab}`}
            >
              {tab === 'plan' ? (
                <PlanTab
                  application={application}
                  score={score}
                  stories={stories}
                  applicationEmail={applicationEmail}
                  locked={locked}
                  onOpenTab={selectTab}
                  onTailorCv={() => {
                    setTab('cv')
                    setMapOpen(false)
                    setAssistantOpen(true)
                  }}
                  onOpenProfile={onOpenProfile}
                />
              ) : null}

              {tab === 'cv' ? (
                <div className="mx-auto w-full max-w-[652px]">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10.5px] whitespace-nowrap tabular-nums text-muted-foreground">
                        {pageLabel}
                      </span>
                      <span className="truncate text-[10.5px] text-muted-foreground">
                        {application.cv.fileName}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {cvClassification ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-muted-foreground hover:text-ink max-sm:h-11"
                          onClick={() => {
                            setAssistantOpen(false)
                            setMapOpen(true)
                          }}
                        >
                          <ListTree />
                          Outline
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 bg-card max-sm:h-11"
                        onClick={() => void handleDownloadCv()}
                        disabled={downloadCvBusy}
                      >
                        {downloadCvBusy ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Download />
                        )}
                        Download
                      </Button>
                      {application.classification && !locked ? (
                        <Button
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 max-sm:h-11"
                          onClick={() => {
                            setMapOpen(false)
                            setAssistantOpen(true)
                          }}
                        >
                          <Sparkles />
                          Tailor CV
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {downloadCvError ? (
                    <p
                      role="alert"
                      className="mb-3 flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px] leading-[1.45] text-muted-foreground"
                    >
                      <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                      {downloadCvError}
                    </p>
                  ) : null}

                  {jdError ? (
                    <p
                      role="alert"
                      className="mb-3 flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px] leading-[1.45] text-muted-foreground"
                    >
                      <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                      {jdError}
                    </p>
                  ) : null}

                  {cvLoadError ? (
                    <p
                      role="alert"
                      className="mb-3 flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px] leading-[1.45] text-muted-foreground"
                    >
                      <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                      {cvLoadError}
                    </p>
                  ) : null}

                  {loadingCv ? (
                    <PaperPlaceholder label="Opening your CV" />
                  ) : pdf ? (
                    <>
                      {pdf.text.length === 0 ? (
                        <p className="mb-3 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                          <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                          No selectable text in this CV, so coverage cannot read it.
                        </p>
                      ) : null}
                      <Suspense fallback={<PaperPlaceholder />}>
                        <PdfPreview key={uploadId} pdf={pdf} scrollRef={paneRef} />
                      </Suspense>
                    </>
                  ) : (
                    <PaperPlaceholder />
                  )}

                  <p className="mt-4 truncate text-center text-[11px] text-muted-foreground">
                    {application.cv.fileName} · Saved in your account
                    {application.cv.kind === 'docx'
                      ? ' · Use the assistant to tailor a bullet'
                      : ' · PDFs are read-only; replace with a DOCX to tailor'}
                  </p>
                </div>
              ) : null}

              {tab === 'letter' ? (
                <CoverLetterTab
                  application={application}
                  canCompose={canCompose}
                  locked={locked}
                  onUpdated={onApplicationUpdated}
                  onUpdate={onUpdateApplication}
                  onOpenProfile={onOpenProfile}
                />
              ) : null}

              {tab === 'email' ? (
                <EmailTab
                  application={application}
                  sending={sending}
                  canCompose={canCompose}
                  applicationEmail={applicationEmail}
                  locked={locked}
                  onUpdated={onApplicationUpdated}
                  onUpdate={onUpdateApplication}
                  onOpenProfile={onOpenProfile}
                />
              ) : null}
            </div>
          </div>
        </section>

        <section className="min-h-0 border-t border-border/70 bg-[#f8fafd] p-3.5 sm:p-4 lg:border-t-0 lg:border-l">
          <JdPanel
            value={jd}
            cvText={pdf?.text ?? ''}
            cvClassification={cvClassification}
            cvStatus={cvStatus}
            cvError={cvReadError}
            cvNeedsDeepRead={cvNeedsDeepRead}
            docx={docx}
            onClassifyCv={() => void runCvClassify('fast')}
            onDeepReadCv={() => void runCvClassify('deep')}
            onApplyCvEdits={applyCvEdits}
            stories={stories}
            onSaveStory={onSaveStory}
            assistantOpen={assistantOpen}
            onAssistantOpen={() => setAssistantOpen(true)}
            onAssistantClose={() => setAssistantOpen(false)}
            onChange={handleJdChange}
            onLoadSample={() => jd}
            initialClassification={application.classification}
            autoClassify={!application.classification}
            showSample={false}
            onClassified={handleClassified}
            locked={locked}
          />
        </section>
      </div>

      <CvMapDrawer
        open={mapOpen}
        cv={cvClassification}
        jd={application.classification?.data ?? null}
        onClose={() => setMapOpen(false)}
      />

      <ConfirmDialog
        open={completeOpen}
        title="Complete this application?"
        description="This locks the CV, cover letter, posting and email. You can still view and download the documents."
        confirmLabel="Complete application"
        busy={completeBusy}
        onConfirm={() => void handleComplete()}
        onClose={() => {
          if (!completeBusy) setCompleteOpen(false)
        }}
      />
    </main>
  )
}
