import { useState } from 'react'

import { CaddieMark, CaddieWordmark } from '@/components/caddie-mark'
import { Button } from '@/components/ui/button'
import { signIn } from '@/lib/auth-client'
import { AlertCircle, LoaderCircle } from 'lucide-react'

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.09 3.58-5.17 3.58-8.85Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  )
}

export function AuthScreen() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleGoogle() {
    setPending(true)
    setError('')

    const result = await signIn.social({
      provider: 'google',
      callbackURL: window.location.origin,
    })

    if (result.error) {
      setError(result.error.message ?? 'Google sign-in could not start.')
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(120%_90%_at_50%_-10%,#ffffff_0%,#f4f6fb_60%,#edf0f7_100%)]">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6">
        <CaddieMark className="size-[26px]" />
        <CaddieWordmark />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[430px] rounded-xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(13,21,38,0.04),0_24px_60px_-40px_rgba(13,21,38,0.35)]">
          <div className="flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600">
            <CaddieMark className="size-6" />
          </div>
          <h1 className="mt-5 text-[22px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">
            Your CV, ready for the role.
          </h1>
          <p className="mt-2 max-w-[38ch] text-[12.5px] leading-[1.55] text-muted-foreground">
            Paste a job description, see what your CV is missing, and tailor it
            with evidence you confirm. Every application stays in your account.
          </p>

          <Button
            variant="outline"
            className="mt-6 h-10 w-full justify-center gap-2 bg-card text-[12.5px] font-medium"
            onClick={() => void handleGoogle()}
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <GoogleMark />
            )}
            {pending ? 'Opening Google…' : 'Continue with Google'}
          </Button>

          {error ? (
            <p
              role="alert"
              className="mt-3 flex items-start gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px] leading-[1.45] text-muted-foreground"
            >
              <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2} />
              {error}
            </p>
          ) : null}

          <p className="mt-4 text-[10.5px] leading-[1.5] text-muted-foreground">
            Google sign-in only. Your CV and applications are saved to your
            account. Cloudflare processes the text only when Caddie reads or
            tailors it.
          </p>
        </div>
      </main>
    </div>
  )
}
