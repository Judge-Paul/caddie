import type { ResearchResult } from '@shared/jd-classification'

export class ResearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResearchError'
  }
}

/**
 * Read public pages about the company through the server. The CV is never part
 * of this request; it sends the company, role, role fields and summary so the
 * search can tell the right "Cardboard" from the wrong one.
 */
export async function researchCompany(
  company: string,
  role: string,
  fields: string[],
  summary: string,
  signal?: AbortSignal,
): Promise<ResearchResult> {
  let response: Response

  try {
    response = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, fields, summary }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ResearchError(
      'Could not reach the research server. Start it with npm run dev and try again.',
    )
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<ResearchResult> & { error?: string })
    | null

  if (!response.ok) {
    const unreachable = response.status === 502 || response.status === 503 || response.status === 504
    throw new ResearchError(
      payload?.error ??
        (unreachable
          ? 'Company research is unavailable right now.'
          : `Company research failed (${response.status}).`),
    )
  }

  if (!payload?.profile) {
    throw new ResearchError('The research server returned an unreadable answer.')
  }

  return payload as ResearchResult
}
