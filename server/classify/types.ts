import type { JdClassification } from '../../shared/jd-classification'

export type ProviderResult = {
  data: JdClassification
  modelId: string
  latencyMs: number
  /** How many model calls it took, including repairs. */
  attempts: number
  usage?: Record<string, number>
}
