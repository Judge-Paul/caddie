import { createHash } from 'node:crypto'

import {
  DOMAINS,
  type ClassificationResult,
  type ClassifyModel,
  type Domain,
  type JdClassification,
} from '../../shared/jd-classification'
import { readCache, writeCache } from '../cache'
import { identitySectors, rememberIdentity } from '../company-identity'
import { readConfig } from '../env'
import { classifyWithGemma } from './gemma'
import { classifyWithJev } from './jev'

const CACHE_NAMESPACE = 'classifications-v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Bump when the prompt or normaliser changes, so old answers are not reused. */
const CLASSIFIER_VERSION = 'v2'

export type ClassifyOptions = {
  /** The eval turns this off so model changes are actually measured. */
  cache?: boolean
}

/** Keep one company's sectors consistent across different postings. */
async function stabiliseCompany(data: JdClassification) {
  if (!data.company.name) return

  const known = await identitySectors(data.company.name)

  if (known && known.length > 0) {
    data.company.sectors = known
    if (data.company.domain === 'unspecified' || data.company.domain === 'other') {
      const primary = known.find((sector) =>
        (DOMAINS as readonly string[]).includes(sector),
      ) as Domain | undefined
      if (primary) data.company.domain = primary
    }
    return
  }

  await rememberIdentity(data.company.name, data.company.sectors)
}

export async function classifyJd(
  jd: string,
  model: ClassifyModel,
  options: ClassifyOptions = {},
): Promise<ClassificationResult> {
  const config = readConfig()
  const useCache = options.cache !== false
  const key = createHash('sha256')
    .update(`${CLASSIFIER_VERSION}|${model}|${config.gemmaModel}|${jd.trim()}`)
    .digest('hex')

  if (useCache) {
    const cached = await readCache<ClassificationResult>(
      CACHE_NAMESPACE,
      key,
      CACHE_TTL_MS,
    )

    if (cached) {
      await stabiliseCompany(cached.data)
      return {
        ...cached,
        meta: { ...cached.meta, latencyMs: 0, cached: true },
      }
    }
  }

  const result =
    model === 'jev' ? await classifyWithJev(jd, config) : await classifyWithGemma(jd, config)

  await stabiliseCompany(result.data)

  const classification: ClassificationResult = {
    data: result.data,
    meta: {
      model,
      modelId: result.modelId,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
      usage: result.usage,
    },
  }

  if (useCache) {
    await writeCache(CACHE_NAMESPACE, key, classification)
  }

  return classification
}
