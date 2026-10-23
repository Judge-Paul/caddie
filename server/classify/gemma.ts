import {
  extractJson,
  normaliseClassification,
} from '../../shared/jd-classification'
import { runChat } from '../cloudflare'
import type { ServerConfig } from '../env'
import { classificationMessages, repairMessages } from './prompt'
import type { ProviderResult } from './types'

const MAX_ATTEMPTS = 2
const MAX_TOKENS = 2600

/**
 * Gemma 4 reads the posting and returns the whole classification. One repair
 * attempt covers the usual failure: prose or a code fence around the JSON.
 */
export async function classifyWithGemma(
  jd: string,
  config: ServerConfig,
): Promise<ProviderResult> {
  const started = performance.now()
  let lastReply = ''
  let usage: Record<string, number> | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runChat(config, {
      model: config.gemmaModel,
      messages:
        attempt === 1 ? classificationMessages(jd) : repairMessages(jd, lastReply),
      maxTokens: MAX_TOKENS,
      temperature: attempt === 1 ? 0.1 : 0,
    })
    usage = result.usage ?? usage
    lastReply = result.text

    try {
      const data = normaliseClassification(extractJson(result.text))
      if (data.requirements.length === 0 && !data.role.title) {
        throw new Error('The model returned an empty classification.')
      }

      return {
        data,
        modelId: config.gemmaModel,
        latencyMs: Math.round(performance.now() - started),
        attempts: attempt,
        usage,
      }
    } catch {
      // fall through to the repair attempt
    }
  }

  throw new Error(
    `Gemma did not return usable JSON twice. Last reply started: "${lastReply.slice(0, 80)}"`,
  )
}
