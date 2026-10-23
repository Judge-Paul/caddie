import { useEffect, useRef, useState } from 'react'

import { CvDocument } from '@/components/cv/cv-document'
import type { CvProfile } from '@/data/cv'
import { A4 } from '@/lib/page'

/**
 * The CV is authored at exact A4 pixel dimensions and scaled down with a
 * transform, so type sizes and line breaks stay identical at every width.
 */
export function CvPreview({ profile }: { profile: CvProfile }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setScale(entry.contentRect.width / A4.width)
    })

    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={frameRef}
      className="relative w-full"
      style={{ height: A4.height * scale }}
    >
      <div
        className="paper-shadow absolute top-0 left-0 origin-top-left bg-white ring-1 ring-black/[0.04]"
        style={{
          width: A4.width,
          height: A4.height,
          transform: `scale(${scale})`,
        }}
      >
        <CvDocument profile={profile} />
      </div>
    </div>
  )
}
