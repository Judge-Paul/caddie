import type { ClassificationResult } from '@shared/jd-classification'

export class ClassifyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassifyError'
  }
}

/**
 * Ask the local classifier to turn a posting into structured data. Nothing else
 * in the app calls the network: coverage and red marks stay on the client.
 */
export async function classifyJd(
  jd: string,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  let response: Response

  try {
    response = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jd, model: 'gemma' }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ClassifyError(
      'Could not reach the classifier. Start it with npm run dev and try again.',
    )
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<ClassificationResult> & { error?: string })
    | null

  if (!response.ok) {
    const unreachable = response.status === 502 || response.status === 503 || response.status === 504
    throw new ClassifyError(
      payload?.error ??
        (unreachable
          ? 'The classifier server is not running. Start it with npm run dev.'
          : `Classification failed (${response.status}).`),
    )
  }

  if (!payload?.data) {
    throw new ClassifyError('The classifier returned an unreadable answer.')
  }

  return payload as ClassificationResult
}
