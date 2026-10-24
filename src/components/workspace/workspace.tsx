import { Suspense, lazy, useEffect, useRef, useState } from 'react'

import { JdPanel } from '@/components/jd/jd-panel'
import { Button } from '@/components/ui/button'
import { getApplicationFile } from '@/lib/account'
import { DOCX_MIME, classifyCvDocx, editCvDocx } from '@/lib/docx'
import type { CvPdf } from '@/lib/pdf'
import type { ApplicationDetail, UpdateApplicationPatch } from '@shared/account'
import type { CvClassification } from '@shared/cv-classification'
import type { CvStory } from '@shared/cv-fit'
import type { ClassificationResult } from '@shared/jd-classification'
import { AlertCircle, ArrowLeft, LoaderCircle, Sparkles } from 'lucide-react'

const PdfPreview = lazy(() =>
  import('@/components/cv/pdf-preview').then((module) => ({
    default: module.PdfPreview,
  })),
)

type WorkspaceProps = {
  application: ApplicationDetail
  stories: CvStory[]
  onBack: () => void
  onUpdateApplication: (patch: UpdateApplicationPatch) => Promise<void>
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

export function Workspace({
  application,
  stories,
  onBack,
  onUpdateApplication,
  onSaveCv,
  onSaveStory,
}: WorkspaceProps) {
  const paneRef = useRef<HTMLElement>(null)
  const jdTimerRef = useRef<number | null>(null)
  const cvRequestRef = useRef<AbortController | null>(null)

  const [pdf, setPdf] = useState<CvPdf | null>(null)
  const [docx, setDocx] = useState<File | null>(null)
  const [uploadId, setUploadId] = useState(0)
  const [loadingCv, setLoadingCv] = useState(true)
  const [cvLoadError, setCvLoadError] = useState('')

  const [jd, setJd] = useState(application.jdText)
  const [jdError, setJdError] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)

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
            error instanceof Error
              ? error.message
              : 'That CV could not be opened.',
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

  async function applyCvEdit(blockId: string, text: string) {
    if (!docx) throw new Error('Upload a DOCX to edit this CV.')

    const result = await editCvDocx(docx, [{ blockId, text }])
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
    setCvClassification((current) => {
      if (!current) return current
      return {
        ...current,
        roles: current.roles.map((role) => ({
          ...role,
          bullets: role.bullets.map((bullet) =>
            bullet.anchor?.blockId === blockId ? { ...bullet, text } : bullet,
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

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(404px,460px)]">
      <section
        ref={paneRef}
        className="min-h-0 overflow-y-auto bg-[radial-gradient(120%_90%_at_50%_-10%,#ffffff_0%,#f4f6fb_60%,#edf0f7_100%)] px-4 pt-5 pb-10 sm:px-8"
      >
        <div className="mx-auto w-full max-w-[652px]">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-3 max-sm:h-11 text-muted-foreground hover:text-ink"
            onClick={onBack}
          >
            <ArrowLeft />
            All applications
          </Button>

          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                CV preview
              </p>
              <h1 className="mt-1 truncate text-[18px] leading-[1.2] font-semibold tracking-[-0.025em] text-ink">
                {application.title ?? 'Untitled application'}
              </h1>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {application.company ?? 'Company not read yet'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10.5px] whitespace-nowrap tabular-nums text-muted-foreground">
                {pageLabel}
              </span>
              {application.classification ? (
                <Button
                  size="sm"
                  className="h-8 gap-1.5 shadow-[0_8px_24px_-16px_rgba(35,71,230,0.9)] max-sm:h-11"
                  onClick={() => setAssistantOpen(true)}
                >
                  <Sparkles />
                  Improve CV
                </Button>
              ) : null}
            </div>
          </div>

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
          onApplyCvEdit={applyCvEdit}
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
        />
      </section>
    </main>
  )
}
