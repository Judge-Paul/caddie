import { useEffect, useRef, useState } from 'react'

/**
 * Measured CSS width of an element. The CV paper is authored at pixel sizes, so
 * both previews need the real number rather than a percentage.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
