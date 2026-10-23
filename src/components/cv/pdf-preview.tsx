import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import { PdfPage } from '@/components/cv/pdf-page'
import type { CvPdf } from '@/lib/pdf'
import { useElementWidth } from '@/lib/use-element-width'
import { ChevronDown, ChevronUp } from 'lucide-react'

const A4_ASPECT = 1123 / 794

type PdfPreviewProps = {
  pdf: CvPdf
  /** The pane that scrolls on desktop. Below `lg` the window scrolls instead. */
  scrollRef?: RefObject<HTMLElement | null>
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35 max-lg:size-11"
    >
      {children}
    </button>
  )
}

/**
 * Page-by-page view of an uploaded CV. Pages are stacked so the whole document
 * can be read the way it prints; the arrows jump between them.
 */
export function PdfPreview({ pdf, scrollRef }: PdfPreviewProps) {
  const [frameRef, width] = useElementWidth<HTMLDivElement>()
  const [measured, setMeasured] = useState<{ doc: CvPdf['doc']; aspects: number[] } | null>(null)
  const [page, setPage] = useState(0)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  const aspects = measured?.doc === pdf.doc ? measured.aspects : []

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const next: number[] = []
      for (let pageNumber = 1; pageNumber <= pdf.pageCount; pageNumber += 1) {
        const viewport = (await pdf.doc.getPage(pageNumber)).getViewport({ scale: 1 })
        next.push(viewport.height / viewport.width)
      }
      if (!cancelled) setMeasured({ doc: pdf.doc, aspects: next })
    })()

    return () => {
      cancelled = true
    }
  }, [pdf])

  // Keep the page counter honest when the reader scrolls by hand.
  useEffect(() => {
    const pane = scrollRef?.current ?? null
    const scroller: HTMLElement | Window =
      pane && pane.scrollHeight > pane.clientHeight + 1 ? pane : window

    let frame = 0
    const update = () => {
      frame = 0
      const top = scroller instanceof Window ? 0 : scroller.getBoundingClientRect().top
      let current = 0
      pageRefs.current.forEach((element, index) => {
        if (element && element.getBoundingClientRect().top - top <= 96) current = index
      })
      setPage(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [pdf, scrollRef])

  function goToPage(index: number) {
    const next = Math.max(0, Math.min(pdf.pageCount - 1, index))
    setPage(next)
    pageRefs.current[next]?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }

  return (
    <div className="relative">
      <div ref={frameRef} className="flex w-full flex-col gap-5">
        {Array.from({ length: pdf.pageCount }, (_, index) => (
          <PdfPage
            key={index}
            doc={pdf.doc}
            pageNumber={index + 1}
            width={width}
            aspect={aspects[index] ?? A4_ASPECT}
            pageRef={(element) => {
              pageRefs.current[index] = element
            }}
          />
        ))}
      </div>

      {pdf.pageCount > 1 ? (
        <div className="sticky bottom-4 z-10 mt-5 flex justify-center">
          <div
            role="group"
            aria-label="CV pages"
            className="flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-[0_1px_2px_rgba(13,21,38,0.06),0_8px_20px_-12px_rgba(13,21,38,0.3)] backdrop-blur-sm"
          >
            <PageButton
              label="Previous page"
              disabled={page === 0}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronUp className="size-4" strokeWidth={2} />
            </PageButton>
            <span className="min-w-11 text-center text-[11px] text-muted-foreground tabular-nums">
              {page + 1} / {pdf.pageCount}
            </span>
            <PageButton
              label="Next page"
              disabled={page === pdf.pageCount - 1}
              onClick={() => goToPage(page + 1)}
            >
              <ChevronDown className="size-4" strokeWidth={2} />
            </PageButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}
