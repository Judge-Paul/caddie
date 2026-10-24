import {
  normaliseCvClassification,
  type CvClassificationResponse,
} from '../../shared/cv-classification'
import { extractJson } from '../../shared/jd-classification'
import { runChat } from '../cloudflare'
import type { ServerConfig } from '../env'
import { parseDocx } from './docx'
import { cvMessages, repairCvMessages } from './prompt'

const MAX_ATTEMPTS = 2
const MAX_TOKENS = 3_000

export class CvClassifyError extends Error {
  readonly status = 422

  constructor(message: string) {
    super(message)
    this.name = 'CvClassifyError'
  }
}

/**
 * CV content is personal data, so this result is never cached on disk. The
 * caller keeps it; the server only parses and classifies the transient request.
 */
export async function classifyCvDocx(
  input: Uint8Array,
  config: ServerConfig,
): Promise<CvClassificationResponse> {
  const blocks = await parseDocx(input)
  if (blocks.every((block) => !block.text)) {
    throw new CvClassifyError('No text was found in this CV.')
  }

  const started = performance.now()
  let lastReply = ''
  let usage: Record<string, number> | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runChat(config, {
      model: config.gemmaModel,
      messages:
        attempt === 1 ? cvMessages(blocks) : repairCvMessages(blocks, lastReply),
      maxTokens: MAX_TOKENS,
      temperature: 0,
    })
    usage = result.usage ?? usage
    lastReply = result.text

    try {
      const data = normaliseCvClassification(extractJson(result.text), blocks)
      if (!data.contact.name && !data.summary && data.roles.length === 0) {
        throw new Error('The model returned no CV content.')
      }

      return {
        data,
        meta: {
          model: 'gemma',
          modelId: config.gemmaModel,
          latencyMs: Math.round(performance.now() - started),
          attempts: attempt,
          usage,
        },
        blocks,
      }
    } catch {
      // one repair attempt
    }
  }

  throw new CvClassifyError('The CV could not be classified. Try again.')
}
