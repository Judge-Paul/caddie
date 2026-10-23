import type {
  ClassificationResult,
  ClassifyModel,
} from '../../shared/jd-classification'
import { readConfig } from '../env'
import { classifyWithGemma } from './gemma'
import { classifyWithJev } from './jev'

export async function classifyJd(
  jd: string,
  model: ClassifyModel,
): Promise<ClassificationResult> {
  const config = readConfig()
  const result =
    model === 'jev' ? await classifyWithJev(jd, config) : await classifyWithGemma(jd, config)

  return {
    data: result.data,
    meta: {
      model,
      modelId: result.modelId,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      usage: result.usage,
    },
  }
}
