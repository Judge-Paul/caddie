import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { CaddieMark, CaddieWordmark } from '@/components/caddie-mark'
import { CvPreview } from '@/components/cv/cv-preview'
import { JdPanel } from '@/components/jd/jd-panel'
import type { CvReadStatus } from '@/components/jd/cv-assistant'
import { Button } from '@/components/ui/button'
import { cv } from '@/data/cv'
import { sampleJd } from '@/data/sample-jd'
import { flattenCv } from '@/lib/analyze'
import { clearCv, readCv, saveCv } from '@/lib/cv-store'
import {
  DOCX_MIME,
  classifyCvDocx,
  convertCvDocx,
  editCvDocx,
} from '@/lib/docx'
import type { CvPdf } from '@/lib/pdf'
import { listStories, saveStory as persistStory } from '@/lib/profile-store'
import type { CvClassification } from '@shared/cv-classification'
import type { CvStory } from '@shared/cv-fit'
import { AlertCircle, LoaderCircle, Lock, Upload, X } from 'lucide-react'

const sampleCvText = flattenCv(cv)

// pdf.js is only worth its weight once there is a PDF to draw.
const PdfPreview = lazy(() =>
  import('@/components/cv/pdf-preview').then((module) => ({ default: module.PdfPreview })),
)

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

export default function App() {
  const [jd, setJd] = useState('')
  const [pdf, setPdf] = useState<CvPdf | null>(null)
  const [docx, setDocx] = useState<File | null>(null)
  const [uploadId, setUploadId] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const [reading, setReading] = useState(false)
  const [readingLabel, setReadingLabel] = useState('Reading your CV')
  const [restoring, setRestoring] = useState(true)
  const [cvClassification, setCvClassification] = useState<CvClassification | null>(null)
  const [cvStatus, setCvStatus] = useState<CvReadStatus>('idle')
  const [cvError, setCvError] = useState('')
  const [stories, setStories] = useState<CvStory[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const restoreCancelledRef = useRef(false)
  const cvRequestRef = useRef<AbortController | null>(null)

  // An uploaded CV replaces the sample as the side the matcher reads.
  const cvText = pdf ? pdf.text : sampleCvText

  useEffect(
    () => () => {
      void pdf?.doc.loadingTask.destroy().catch(() => {})
    },
    [pdf],
  )

  // Bring back the last uploaded CV on load. Best effort: storage may be
  // unavailable (private mode), in which case the sample stays.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const stored = await readCv()
        if (!stored || cancelled || restoreCancelledRef.current) return

        const { loadCvPdf } = await import('@/lib/pdf')
        let renderedFile: File

        if (stored.kind === 'pdf') {
          renderedFile = stored.source
        } else if (stored.rendered) {
          renderedFile = stored.rendered
        } else {
          const blob = await convertCvDocx(stored.source)
          renderedFile = new File(
            [blob],
            stored.source.name.replace(/\.docx$/i, '.pdf'),
            { type: 'application/pdf' },
          )
          void saveCv({ kind: 'docx', source: stored.source, rendered: renderedFile }).catch(
            () => {},
          )
        }

        const next = await loadCvPdf(renderedFile)

        if (cancelled || restoreCancelledRef.current) {
          void next.doc.loadingTask.destroy().catch(() => {})
          return
        }

        setPdf(next)
        setDocx(stored.kind === 'docx' ? stored.source : null)
        setUploadId((id) => id + 1)
      } catch {
        void clearCv().catch(() => {})
        if (!cancelled) {
          setUploadError('The saved CV could not be restored. Upload it again.')
        }
      } finally {
        if (!cancelled) setRestoring(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void listStories()
      .then((loaded) => {
        if (!cancelled) setStories(loaded)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      cvRequestRef.current?.abort()
    },
    [],
  )

  function resetCvClassification() {
    cvRequestRef.current?.abort()
    cvRequestRef.current = null
    setCvClassification(null)
    setCvStatus('idle')
    setCvError('')
  }

  async function classifyCv() {
    if (!docx || cvStatus === 'loading' || cvClassification) return

    cvRequestRef.current?.abort()
    const controller = new AbortController()
    cvRequestRef.current = controller
    setCvStatus('loading')
    setCvError('')

    try {
      const result = await classifyCvDocx(docx, controller.signal)
      if (controller.signal.aborted) return
      setCvClassification(result.data)
      setCvStatus('ready')
    } catch (error) {
      if (controller.signal.aborted) return
      setCvError(
        error instanceof Error ? error.message : 'That CV could not be read.',
      )
      setCvStatus('error')
    } finally {
      if (cvRequestRef.current === controller) cvRequestRef.current = null
    }
  }

  async function applyCvEdit(blockId: string, text: string) {
    if (!docx) throw new Error('Upload a DOCX to edit your CV.')

    const result = await editCvDocx(docx, [{ blockId, text }])
    const source = new File([result.docx], docx.name, { type: DOCX_MIME })
    const rendered = new File(
      [result.pdf],
      docx.name.replace(/\.docx$/i, '.pdf'),
      { type: 'application/pdf' },
    )
    const { loadCvPdf } = await import('@/lib/pdf')
    const next = await loadCvPdf(rendered)

    setPdf(next)
    setDocx(source)
    setUploadId((id) => id + 1)
    await saveCv({ kind: 'docx', source, rendered }).catch(() => {})

    setCvClassification((current) => {
      if (!current) return current
      return {
        ...current,
        roles: current.roles.map((role) => ({
          ...role,
          bullets: role.bullets.map((bullet) =>
            bullet.anchor?.blockId === blockId
              ? { ...bullet, text }
              : bullet,
          ),
        })),
      }
    })
  }

  function handleSaveStory(story: CvStory) {
    setStories((current) => [
      story,
      ...current.filter((entry) => entry.id !== story.id),
    ])
    void persistStory(story).catch(() => {})
  }

  function openPicker() {
    fileInputRef.current?.click()
  }

  async function handleFile(file: File | undefined) {
    if (!file) return

    const isDocx =
      /\.docx$/i.test(file.name) || file.type.includes('wordprocessingml')

    resetCvClassification()
    restoreCancelledRef.current = true
    setUploadError('')
    setReading(true)
    setReadingLabel(isDocx ? 'Rendering your CV' : 'Reading your CV')
    const previous = pdf

    try {
      const { loadCvPdf } = await import('@/lib/pdf')

      if (isDocx) {
        const renderedBlob = await convertCvDocx(file)
        const renderedFile = new File(
          [renderedBlob],
          file.name.replace(/\.docx$/i, '.pdf'),
          { type: 'application/pdf' },
        )
        const next = await loadCvPdf(renderedFile)

        setPdf(next)
        setDocx(file)
        setUploadId((id) => id + 1)
        paneRef.current?.scrollTo({ top: 0 })
        window.setTimeout(() => {
          void previous?.doc.loadingTask.destroy().catch(() => {})
        }, 0)
        void saveCv({ kind: 'docx', source: file, rendered: renderedFile }).catch(
          () => {},
        )
      } else {
        const next = await loadCvPdf(file)

        setPdf(next)
        setDocx(null)
        setUploadId((id) => id + 1)
        paneRef.current?.scrollTo({ top: 0 })
        window.setTimeout(() => {
          void previous?.doc.loadingTask.destroy().catch(() => {})
        }, 0)
        void saveCv({ kind: 'pdf', source: file, rendered: null }).catch(() => {})
      }
    } catch (error) {
      setUploadError(
        error instanceof Error && error.name === 'CvPdfError'
          ? error.message
          : error instanceof Error && error.message
            ? error.message
            : 'That CV could not be read. Try another PDF or DOCX.',
      )
    } finally {
      setReading(false)
      // allow picking the same file again
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removePdf() {
    restoreCancelledRef.current = true
    resetCvClassification()
    setPdf(null)
    setDocx(null)
    setUploadError('')
    void clearCv().catch(() => {})
  }

  const pageLabel = pdf
    ? `${docx ? 'DOCX' : 'PDF'} · ${pdf.pageCount} ${
        pdf.pageCount === 1 ? 'page' : 'pages'
      }`
    : 'A4 · 1 page'

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <CaddieMark className="size-[26px]" />
          <CaddieWordmark />
          <span className="hidden h-4 w-px bg-border sm:block" />
          <span className="hidden text-[12px] text-muted-foreground sm:block">
            JD → CV matcher
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] whitespace-nowrap text-muted-foreground">
          <Lock className="size-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">Matching runs in your browser</span>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(404px,460px)]">
        <section
          ref={paneRef}
          className="min-h-0 lg:overflow-y-auto bg-[radial-gradient(120%_90%_at_50%_-10%,#ffffff_0%,#f4f6fb_60%,#edf0f7_100%)] px-4 pt-5 pb-10 sm:px-8"
        >
          <div className="mx-auto w-full max-w-[652px]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  CV preview
                </span>
                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10.5px] whitespace-nowrap tabular-nums text-muted-foreground">
                  {pageLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {pdf ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-ink max-sm:size-11"
                    onClick={removePdf}
                    aria-label="Remove uploaded CV"
                  >
                    <X />
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 bg-card max-sm:h-11"
                  onClick={openPicker}
                  disabled={reading}
                  aria-busy={reading}
                >
                  {reading ? <LoaderCircle className="animate-spin" /> : <Upload />}
                  {reading ? 'Reading…' : pdf ? 'Replace' : 'Upload CV'}
                </Button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
              hidden
              onChange={(event) => {
                void handleFile(event.target.files?.[0])
              }}
            />

            {uploadError ? (
              <p
                role="alert"
                className="mb-3 flex items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-[11.5px] text-destructive"
              >
                <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                {uploadError}
              </p>
            ) : null}

            {pdf && pdf.text.length === 0 ? (
              <p className="mb-3 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
                No selectable text in this CV, so coverage cannot read it.
              </p>
            ) : null}

            {reading && !pdf ? (
              <PaperPlaceholder label={readingLabel} />
            ) : restoring && !pdf ? (
              <PaperPlaceholder label="Restoring your CV" />
            ) : pdf ? (
              <Suspense fallback={<PaperPlaceholder />}>
                <PdfPreview key={uploadId} pdf={pdf} scrollRef={paneRef} />
              </Suspense>
            ) : (
              <CvPreview profile={cv} />
            )}

            <p className="mt-4 truncate text-center text-[11px] text-muted-foreground">
              {pdf
                ? docx
                  ? `${docx.name} · DOCX converted on the server`
                  : `${pdf.fileName} · Stays in your browser`
                : 'Sample profile · Upload your own CV to match against it.'}
            </p>
          </div>
        </section>

        <section className="min-h-0 border-t border-border/70 bg-[#f8fafd] p-3.5 sm:p-4 lg:border-t-0 lg:border-l">
          <JdPanel
            value={jd}
            cvText={cvText}
            cvClassification={cvClassification}
            cvStatus={cvStatus}
            cvError={cvError}
            docx={docx}
            onClassifyCv={() => void classifyCv()}
            onApplyCvEdit={applyCvEdit}
            stories={stories}
            onSaveStory={handleSaveStory}
            onChange={setJd}
            onLoadSample={() => {
              setJd(sampleJd)
              return sampleJd
            }}
          />
        </section>
      </main>
    </div>
  )
}
