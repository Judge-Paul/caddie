/**
 * Server configuration. Cloudflare credentials never reach the browser: Vite
 * only exposes `VITE_`-prefixed variables, and these have no prefix.
 */

export type ServerConfig = {
  accountId: string
  apiKey: string
  gemmaModel: string
  jevModel: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export const DEFAULT_GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.14.0'

export function readConfig(): ServerConfig {
  const accountId = process.env.CF_ACCOUNT_ID?.trim()
  const apiKey = process.env.CF_API_KEY?.trim()

  if (!accountId || !apiKey) {
    throw new ConfigError(
      'CF_ACCOUNT_ID and CF_API_KEY must be set in .env.local before classifying.',
    )
  }

  return {
    accountId,
    apiKey,
    gemmaModel: process.env.CF_GEMMA_MODEL?.trim() || DEFAULT_GEMMA_MODEL,
    jevModel: process.env.CF_JEV_MODEL?.trim() || DEFAULT_JEV_MODEL,
  }
}

export function configSummary() {
  return {
    configured: Boolean(process.env.CF_ACCOUNT_ID && process.env.CF_API_KEY),
    gemmaModel: process.env.CF_GEMMA_MODEL?.trim() || DEFAULT_GEMMA_MODEL,
    jevModel: process.env.CF_JEV_MODEL?.trim() || DEFAULT_JEV_MODEL,
  }
}
