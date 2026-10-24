import { useCallback, useEffect, useRef, useState } from 'react'

import { AuthScreen } from '@/components/auth/auth-screen'
import { CaddieMark, CaddieWordmark } from '@/components/caddie-mark'
import { Dashboard } from '@/components/dashboard/dashboard'
import { Workspace } from '@/components/workspace/workspace'
import { Button } from '@/components/ui/button'
import {
  createApplication,
  deleteApplication,
  getApplication,
  getMe,
  saveApplicationCv,
  saveStory,
  updateApplication,
  uploadBaseCv,
} from '@/lib/account'
import { signOut, useSession } from '@/lib/auth-client'
import type {
  AccountMe,
  AccountUser,
  ApplicationDetail,
  UpdateApplicationPatch,
} from '@shared/account'
import type { CvStory } from '@shared/cv-fit'
import { AlertCircle, LoaderCircle, LogOut } from 'lucide-react'

function Splash({ label = 'Opening Caddie' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[radial-gradient(120%_90%_at_50%_-10%,#ffffff_0%,#f4f6fb_60%,#edf0f7_100%)]">
      <CaddieMark className="size-10" />
      <span className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
        {label}
      </span>
    </div>
  )
}

function AccountError({
  message,
  onRetry,
  onSignOut,
}: {
  message: string
  onRetry: () => void
  onSignOut: () => void
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[430px] rounded-xl border border-border bg-card p-6">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
          <AlertCircle className="size-5" strokeWidth={1.75} />
        </div>
        <h1 className="mt-4 text-[16px] font-semibold tracking-[-0.02em] text-ink">
          Could not open your account
        </h1>
        <p className="mt-1.5 text-[12px] leading-[1.5] text-muted-foreground">
          {message}
        </p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}

function AccountApp({ user }: { user: AccountUser }) {
  const [me, setMe] = useState<AccountMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [active, setActive] = useState<ApplicationDetail | null>(null)
  const mountedRef = useRef(true)

  const loadMe = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    setError('')
    try {
      const next = await getMe()
      if (mountedRef.current) setMe(next)
    } catch (caught) {
      if (mountedRef.current) {
        setError(
          caught instanceof Error ? caught.message : 'Could not open your account.',
        )
      }
    } finally {
      if (initial && mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadMe(true)
    return () => {
      mountedRef.current = false
    }
  }, [loadMe])

  function patchMeApplication(updated: ApplicationDetail) {
    setMe((current) =>
      current
        ? {
            ...current,
            applications: current.applications.map((application) =>
              application.id === updated.id ? updated : application,
            ),
          }
        : current,
    )
  }

  async function handleOpenApplication(id: string) {
    setOpeningId(id)
    setActionError('')
    try {
      const detail = await getApplication(id)
      setActive(detail)
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'That application could not be opened.',
      )
    } finally {
      setOpeningId(null)
    }
  }

  async function handleCreateApplication(jdText: string) {
    const detail = await createApplication(jdText)
    await loadMe().catch(() => {})
    setActive(detail)
  }

  function handleBack() {
    setActive(null)
    setActionError('')
    void loadMe()
  }

  async function handleUpdateApplication(patch: UpdateApplicationPatch) {
    if (!active) return
    const updated = await updateApplication(active.id, patch)
    setActive(updated)
    patchMeApplication(updated)
  }

  async function handleSaveCv(docx: Blob, pdf: Blob) {
    if (!active) throw new Error('No application is open.')
    const updated = await saveApplicationCv(active.id, docx, pdf)
    setActive(updated)
    patchMeApplication(updated)
  }

  function handleSaveStory(story: CvStory) {
    void saveStory(story)
      .then(({ story: saved }) => {
        setMe((current) =>
          current
            ? {
                ...current,
                stories: [
                  saved,
                  ...current.stories.filter((entry) => entry.id !== saved.id),
                ],
              }
            : current,
        )
      })
      .catch(() => {})
  }

  async function handleUploadCv(file: File) {
    await uploadBaseCv(file)
    await loadMe()
  }

  async function handleDeleteApplication(id: string) {
    await deleteApplication(id)
    await loadMe()
  }

  async function handleSignOut() {
    await signOut()
    setActive(null)
    setMe(null)
  }

  if (loading) return <Splash />

  if (!me) {
    return (
      <AccountError
        message={error || 'The account database did not answer.'}
        onRetry={() => void loadMe(true)}
        onSignOut={() => void handleSignOut()}
      />
    )
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <CaddieMark className="size-[26px]" />
          <CaddieWordmark />
          <span className="hidden h-4 w-px bg-border sm:block" />
          <span className="hidden text-[12px] text-muted-foreground sm:block">
            {active ? 'Application' : 'Applications'}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-[11.5px] font-medium text-ink">
              {user.name || user.email}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {user.email}
            </p>
          </div>
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="size-7 rounded-full object-cover ring-1 ring-border"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700 ring-1 ring-border">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-ink"
            onClick={() => void handleSignOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut />
          </Button>
        </div>
      </header>

      {active ? (
        <Workspace
          key={active.id}
          application={active}
          stories={me.stories}
          onBack={handleBack}
          onUpdateApplication={handleUpdateApplication}
          onSaveCv={handleSaveCv}
          onSaveStory={handleSaveStory}
        />
      ) : (
        <Dashboard
          me={me}
          openingId={openingId}
          actionError={actionError || error}
          onOpenApplication={(id) => void handleOpenApplication(id)}
          onCreateApplication={handleCreateApplication}
          onDeleteApplication={handleDeleteApplication}
          onUploadCv={handleUploadCv}
        />
      )}
    </div>
  )
}

export default function App() {
  const { data: session, isPending } = useSession()

  if (isPending) return <Splash label="Checking your session" />
  if (!session) return <AuthScreen />

  return (
    <AccountApp
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      }}
    />
  )
}
