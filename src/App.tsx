import { useCallback, useEffect, useRef, useState } from 'react'

import { AuthScreen } from '@/components/auth/auth-screen'
import { CaddieWordmark } from '@/components/caddie-wordmark'
import { Dashboard } from '@/components/dashboard/dashboard'
import { Profile } from '@/components/profile/profile'
import { Workspace } from '@/components/workspace/workspace'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  createApplication,
  deleteApplication,
  getApplication,
  getMe,
  linkTelegram,
  previewTelegramLink,
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
      <CaddieWordmark />
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
  const [view, setView] = useState<'applications' | 'profile'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'profile'
      ? 'profile'
      : 'applications',
  )
  const [telegramNotice, setTelegramNotice] = useState('')
  const [pendingTelegram, setPendingTelegram] = useState<{
    token: string
    label: string
  } | null>(null)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const mountedRef = useRef(true)
  const telegramLinkHandled = useRef(false)

  const loadMe = useCallback(async () => {
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
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void (async () => {
      await loadMe()
      if (mountedRef.current) setLoading(false)
    })()
    return () => {
      mountedRef.current = false
    }
  }, [loadMe])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') !== 'profile') return
    params.delete('view')
    const query = params.toString()
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
  }, [])

  useEffect(() => {
    if (!me || telegramLinkHandled.current) return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('telegram')
    if (!token) return
    telegramLinkHandled.current = true
    params.delete('telegram')
    const query = params.toString()
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
    void previewTelegramLink(token)
      .then(({ preview }) => {
        setPendingTelegram({
          token,
          label: preview.username
            ? `@${preview.username}`
            : preview.firstName || 'this Telegram chat',
        })
      })
      .catch((caught) => {
        setTelegramNotice(
          caught instanceof Error
            ? caught.message
            : 'That Telegram link could not be checked.',
        )
      })
  }, [me])

  async function confirmTelegramConnect() {
    if (!pendingTelegram) return
    setTelegramBusy(true)
    try {
      await linkTelegram(pendingTelegram.token)
      setPendingTelegram(null)
      setTelegramNotice('Telegram connected.')
      setView('profile')
      await loadMe()
    } catch (caught) {
      setTelegramNotice(
        caught instanceof Error
          ? caught.message
          : 'That Telegram link could not be connected.',
      )
      setPendingTelegram(null)
    } finally {
      setTelegramBusy(false)
    }
  }

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
      setView('applications')
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
    setView('applications')
    setActive(detail)
  }

  function handleBack() {
    setActive(null)
    setView('applications')
    setActionError('')
    void loadMe()
  }

  function handleOpenProfile() {
    setView('profile')
    setActionError('')
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
    setView('applications')
    setMe(null)
  }

  if (loading) return <Splash />

  if (!me) {
    return (
      <AccountError
        message={error || 'The account database did not answer.'}
        onRetry={() => {
          setLoading(true)
          void loadMe().finally(() => {
            if (mountedRef.current) setLoading(false)
          })
        }}
        onSignOut={() => void handleSignOut()}
      />
    )
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setActive(null)
              setView('applications')
              setActionError('')
            }}
            className="flex shrink-0 items-center gap-2 rounded-md outline-none max-sm:size-11 max-sm:justify-center focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Caddie applications"
          >
            <CaddieWordmark />
          </button>

          <span className="hidden h-4 w-px bg-border sm:block" />

          <nav className="flex items-center gap-0.5" aria-label="Primary">
            <NavButton
              active={view === 'applications'}
              onClick={() => {
                setView('applications')
                setActionError('')
              }}
            >
              Applications
            </NavButton>
            <NavButton active={view === 'profile'} onClick={handleOpenProfile}>
              Profile
            </NavButton>
          </nav>
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
            className="text-muted-foreground hover:text-ink max-sm:size-11"
            onClick={() => void handleSignOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut />
          </Button>
        </div>
      </header>

      <ConfirmDialog
        open={Boolean(pendingTelegram)}
        title="Connect Telegram?"
        description={`Connect ${pendingTelegram?.label ?? 'this Telegram chat'} to this Caddie account?${
          me.telegram.connected
            ? ' This will replace your current Telegram connection.'
            : ''
        }`}
        confirmLabel="Connect Telegram"
        busy={telegramBusy}
        onConfirm={() => void confirmTelegramConnect()}
        onClose={() => {
          if (!telegramBusy) setPendingTelegram(null)
        }}
      >
        Only connect a Telegram chat you control. That chat will be able to
        prepare and send applications as this account.
      </ConfirmDialog>

      {telegramNotice ? (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-[520px] items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-[0_18px_50px_-24px_rgba(13,21,38,0.4)] sm:left-auto sm:right-6 sm:mx-0">
          <p role="status" className="text-[11.5px] leading-[1.45] text-ink">
            {telegramNotice}
          </p>
          <button
            type="button"
            onClick={() => setTelegramNotice('')}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {view === 'profile' ? (
        <Profile me={me} onUploadCv={handleUploadCv} onRefreshMe={loadMe} />
      ) : active ? (
        <Workspace
          key={active.id}
          application={active}
          stories={me.stories}
          sending={me.sending}
          onBack={handleBack}
          onOpenProfile={handleOpenProfile}
          onUpdateApplication={handleUpdateApplication}
          onApplicationUpdated={(updated) => {
            setActive(updated)
            patchMeApplication(updated)
          }}
          onSaveCv={handleSaveCv}
          onSaveStory={handleSaveStory}
        />
      ) : (
        <Dashboard
          me={me}
          openingId={openingId}
          actionError={actionError || error}
          onOpenApplication={(id) => void handleOpenApplication(id)}
          onOpenProfile={handleOpenProfile}
          onCreateApplication={handleCreateApplication}
          onDeleteApplication={handleDeleteApplication}
          onUploadCv={handleUploadCv}
        />
      )}
    </div>
  )
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-2 py-1.5 text-[11.5px] max-sm:min-h-11 max-sm:px-3 font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-muted-foreground hover:text-ink'
      }`}
    >
      {children}
    </button>
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
