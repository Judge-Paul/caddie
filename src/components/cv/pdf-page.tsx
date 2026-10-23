import { useEffect, useRef, useState } from 'react'

import {
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'

type PdfPageProps = {
  doc: PDFDocumentProxy
  pageNumber: number
  /** Rendered width in CSS pixels. */
  width: number
  /** Page height ÷ width, so the paper keeps its proportions before it paints. */
  aspect: number
  pageRef?: (element: HTMLDivElement | null) => void
}

/**
 * One PDF page: a canvas for the artwork, with pdf.js's text layer on top so the
 * document can be selected and copied exactly like the printed page.
 */
export function PdfPage({ doc, pageNumber, width, aspect, pageRef }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = textRef.current
    if (!canvas || !container || width <= 0) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    let textLayer: TextLayer | null = null

    container.replaceChildren()
    setFailed(false)

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const scale = width / page.getViewport({ scale: 1 }).width
        const viewport = page.getViewport({ scale })
        // Render above CSS pixels so type stays sharp on high-density screens.
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

        canvas.width = Math.max(1, Math.round(viewport.width * pixelRatio))
        canvas.height = Math.max(1, Math.round(viewport.height * pixelRatio))
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        // pdf.js positions the text layer with these custom properties.
        container.style.setProperty('--scale-factor', String(scale))

        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas is unavailable')

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })
        await renderTask.promise
        if (cancelled) return

        const textContent = await page.getTextContent()
        if (cancelled) return

        textLayer = new TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        })
        await textLayer.render()
      } catch (error) {
        if (cancelled) return
        if (error instanceof Error && error.name === 'RenderingCancelledException') return
        setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      container.replaceChildren()
    }
  }, [doc, pageNumber, width])

  return (
    <div
      ref={pageRef}
      className="paper-shadow relative w-full scroll-mt-4 overflow-hidden bg-white ring-1 ring-black/[0.04]"
      style={{ height: width * aspect }}
    >
      <canvas ref={canvasRef} aria-hidden className="absolute top-0 left-0" />
      <div ref={textRef} className="textLayer" />
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[11px] text-muted-foreground">
          Page {pageNumber} could not be drawn. Your file is unchanged.
        </p>
      ) : null}
    </div>
  )
}
