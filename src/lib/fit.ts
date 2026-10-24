import type { FitRequest, FitResponse } from '@shared/cv-fit'

export class FitClientError extends Error {
  readonly status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'FitClientError'
    this.status = status
  }
}

export async function proposeCvFit(
  input: FitRequest,
  signal?: AbortSignal,
): Promise<FitResponse> {
  let response: Response

  try {
    response = await fetch('/api/cv/fit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new FitClientError(
      'Could not reach the CV assistant. Start the server with npm run dev.',
      503,
    )
  }

  const payload = (await response.json().catch(() => null)) as
    | (FitResponse & { error?: string })
    | null

  if (!response.ok) {
    throw new FitClientError(
      payload?.error ?? `The CV assistant failed (${response.status}).`,
      response.status,
    )
  }

  if (!payload || !('type' in payload)) {
    throw new FitClientError('The CV assistant returned an unreadable answer.')
  }

  return payload
}
