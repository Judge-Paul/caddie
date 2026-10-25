import type {
  AccountCv,
  AccountCvKind,
  AccountMe,
  ApplicationDetail,
  ApplicationSummary,
  ComposeKind,
  CreateApplicationInput,
  PublicWork,
  SavePublicWorkInput,
  SaveSendingInput,
  SendApplicationInput,
  SendingSettings,
  TelegramStatus,
  UpdateApplicationPatch,
} from '@shared/account'
import type { CvStory } from '@shared/cv-fit'

import { DOCX_MIME, blobToBase64 } from './docx'

export class AccountApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status = 500, code?: string) {
    super(message)
    this.name = 'AccountApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null

  if (!response.ok) {
    throw new AccountApiError(
      payload?.error ?? `Request failed (${response.status}).`,
      response.status,
      payload?.code,
    )
  }

  return payload as T
}

async function file(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new AccountApiError(
      payload?.error ?? `File unavailable (${response.status}).`,
      response.status,
    )
  }
  return response.blob()
}

export function getMe() {
  return request<AccountMe>('/api/me')
}

export function uploadBaseCv(file: File) {
  const isDocx =
    /\.docx$/i.test(file.name) || file.type.includes('wordprocessingml')

  return request<{ cv: AccountCv }>('/api/me/cv', {
    method: 'POST',
    headers: {
      'Content-Type': isDocx ? DOCX_MIME : 'application/pdf',
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  })
}

export function deleteBaseCv() {
  return request<{ ok: true }>('/api/me/cv', { method: 'DELETE' })
}

export function previewTelegramLink(token: string) {
  return request<{
    preview: { username: string | null; firstName: string | null; expiresAt: string }
  }>('/api/telegram/link/preview', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export function linkTelegram(token: string) {
  return request<{ telegram: TelegramStatus }>('/api/telegram/link', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export function unlinkTelegram() {
  return request<{ telegram: TelegramStatus }>('/api/telegram/link', {
    method: 'DELETE',
  })
}

export function savePublicWork(input: SavePublicWorkInput) {
  return request<{ publicWork: PublicWork }>('/api/me/public-work', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function saveSending(input: SaveSendingInput) {
  return request<{ sending: SendingSettings }>('/api/me/sending', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function testSending() {
  return request<{ sending: SendingSettings }>('/api/me/sending/test', {
    method: 'POST',
  })
}

export function deleteSending() {
  return request<{ sending: SendingSettings }>('/api/me/sending', {
    method: 'DELETE',
  })
}

export function deleteSendingKey() {
  return request<{ sending: SendingSettings }>('/api/me/sending/key', {
    method: 'DELETE',
  })
}

export function completeApplication(id: string) {
  return request<ApplicationDetail>(`/api/applications/${id}/complete`, {
    method: 'POST',
  })
}

export function getBaseCvFile(kind: AccountCvKind) {
  return file(`/api/me/cv/${kind}`)
}

export function createApplication(jdText: string) {
  const body: CreateApplicationInput = { jdText }
  return request<ApplicationDetail>('/api/applications', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getApplication(id: string) {
  return request<ApplicationDetail>(`/api/applications/${id}`)
}

export function composeApplication(id: string, kind: ComposeKind) {
  return request<ApplicationDetail>(`/api/applications/${id}/compose`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  })
}

export function sendApplication(id: string, input: SendApplicationInput) {
  return request<ApplicationDetail>(`/api/applications/${id}/send`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateApplication(id: string, patch: UpdateApplicationPatch) {
  return request<ApplicationDetail>(`/api/applications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteApplication(id: string) {
  return request<{ ok: true }>(`/api/applications/${id}`, { method: 'DELETE' })
}

export function getApplicationFile(id: string, kind: AccountCvKind) {
  return file(`/api/applications/${id}/cv/${kind}`)
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function downloadApplicationFile(
  id: string,
  kind: AccountCvKind,
  fileName: string,
) {
  triggerDownload(await file(`/api/applications/${id}/cv/${kind}`), fileName)
}

export async function downloadApplicationCoverLetter(id: string, fileName: string) {
  const response = await fetch(`/api/applications/${id}/cover-letter.pdf`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new AccountApiError(
      payload?.error ?? `Letter download failed (${response.status}).`,
      response.status,
    )
  }
  triggerDownload(await response.blob(), fileName)
}

export async function saveApplicationCv(
  id: string,
  docx: Blob,
  pdf: Blob,
) {
  const [docxBase64, pdfBase64] = await Promise.all([
    blobToBase64(docx),
    blobToBase64(pdf),
  ])

  return request<ApplicationDetail>(`/api/applications/${id}/cv`, {
    method: 'PUT',
    body: JSON.stringify({ docx: docxBase64, pdf: pdfBase64 }),
  })
}

export function saveStory(story: CvStory) {
  return request<{ story: CvStory }>('/api/me/stories', {
    method: 'POST',
    body: JSON.stringify(story),
  })
}

export function deleteStory(id: string) {
  return request<{ ok: true }>(`/api/me/stories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export type { AccountCv, ApplicationDetail, ApplicationSummary }
