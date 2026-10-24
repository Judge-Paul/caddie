import type { CvPlanRequest, CvPlanResponse } from '@shared/cv-plan'

export class CvPlanClientError extends Error {
  readonly status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'CvPlanClientError'
    this.status = status
  }
}

export async function planCvEdits(
  input: CvPlanRequest,
  signal?: AbortSignal,
): Promise<CvPlanResponse> {
  let response: Response

  try {
    response = await fetch('/api/cv/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new CvPlanClientError(
      'Could not reach the CV planner. Start the server with npm run dev.',
      503,
    )
  }

  const payload = (await response.json().catch(() => null)) as
    | (CvPlanResponse & { error?: string })
    | null

  if (!response.ok) {
    throw new CvPlanClientError(
      payload?.error ?? `The CV planner failed (${response.status}).`,
      response.status,
    )
  }

  if (!payload || !('type' in payload)) {
    throw new CvPlanClientError('The CV planner returned an unreadable answer.')
  }

  return payload
}
