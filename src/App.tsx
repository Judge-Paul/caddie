import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { CaddieMark, CaddieWordmark } from '@/components/caddie-mark'
import { CvPreview } from '@/components/cv/cv-preview'
import { JdPanel } from '@/components/jd/jd-panel'
import { Button } from '@/components/ui/button'
import { cv } from '@/data/cv'
import { sampleJd } from '@/data/sample-jd'
import { analyze, flattenCv } from '@/lib/analyze'
import type { CvPdf } from '@/lib/pdf'
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
  const [uploadId, setUploadId] = useState(0)
  const [uploadError, setUploadError] = useState('')
  const [reading, setReading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const paneRef = useRef<HTMLElement>(null)

  // An uploaded CV replaces the sample as the side the matcher reads.
  const cvText = pdf ? pdf.text : sampleCvText
  const analysis = useMemo(() => analyze(cvText, jd), [cvText, jd])

  useEffect(
    () => () => {
      void pdf?.doc.loadingTask.destroy().catch(() => {})
    },
    [pdf],
  )

  function openPicker() {
    fileInputRef.current?.click()
  }

  async function handleFile(file: File | undefined) {
    if (!file) return

    setUploadError('')
    setReading(true)
    const previous = pdf

    try {
      const { loadCvPdf } = await import('@/lib/pdf')
      const next = await loadCvPdf(file)
      setPdf(next)
      setUploadId((id) => id + 1)
      paneRef.current?.scrollTo({ top: 0 })
      // release the old document once the new one has painted
      window.setTimeout(() => {
        void previous?.doc.loadingTask.destroy().catch(() => {})
      }, 0)
    } catch (error) {
      setUploadError(
        error instanceof Error && error.name === 'CvPdfError'
          ? error.message
          : 'That CV could not be read. Try another PDF.',
      )
    } finally {
      setReading(false)
      // allow picking the same file again
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removePdf() {
    setPdf(null)
    setUploadError('')
  }

  const pageLabel = pdf
    ? `PDF · ${pdf.pageCount} ${pdf.pageCount === 1 ? 'page' : 'pages'}`
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
          <span className="hidden sm:inline">Runs in your browser</span>
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
              accept="application/pdf,.pdf"
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
                No selectable text in this PDF, so coverage cannot read it.
              </p>
            ) : null}

            {reading && !pdf ? (
              <PaperPlaceholder label="Reading your CV" />
            ) : pdf ? (
              <Suspense fallback={<PaperPlaceholder />}>
                <PdfPreview key={uploadId} pdf={pdf} scrollRef={paneRef} />
              </Suspense>
            ) : (
              <CvPreview profile={cv} />
            )}

            <p className="mt-4 truncate text-center text-[11px] text-muted-foreground">
              {pdf
                ? `${pdf.fileName} · Stays in your browser`
                : 'Sample profile · Upload your own CV to match against it.'}
            </p>
          </div>
        </section>

        <section className="min-h-0 border-t border-border/70 bg-[#f8fafd] p-3.5 sm:p-4 lg:border-t-0 lg:border-l">
          <JdPanel
            value={jd}
            analysis={analysis}
            onChange={setJd}
            onLoadSample={() => setJd(sampleJd)}
          />
        </section>
      </main>
    </div>
  )
}
