import { useMemo, useState } from 'react'

import { CaddieMark, CaddieWordmark } from '@/components/caddie-mark'
import { CvPreview } from '@/components/cv/cv-preview'
import { JdPanel } from '@/components/jd/jd-panel'
import { cv } from '@/data/cv'
import { sampleJd } from '@/data/sample-jd'
import { analyze, flattenCv } from '@/lib/analyze'
import { Lock } from 'lucide-react'

const cvText = flattenCv(cv)

export default function App() {
  const [jd, setJd] = useState('')
  const analysis = useMemo(() => analyze(cvText, jd), [jd])

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
        <section className="min-h-0 overflow-y-auto bg-[radial-gradient(120%_90%_at_50%_-10%,#ffffff_0%,#f4f6fb_60%,#edf0f7_100%)] px-4 pt-5 pb-10 sm:px-8">
          <div className="mx-auto w-full max-w-[652px]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  CV preview
                </span>
                <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                  A4 · 1 page
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">Read only</span>
            </div>

            <CvPreview profile={cv} />

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              Sample profile · CV upload and editing come next.
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
