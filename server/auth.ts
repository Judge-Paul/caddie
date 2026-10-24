import { betterAuth } from 'better-auth'
import { mongodbAdapter } from '@better-auth/mongo-adapter'

import { mongo } from './mongo'

function createAuth(
  store: NonNullable<ReturnType<typeof mongo>>,
  secret: string,
  googleId: string,
  googleSecret: string,
  baseURL: string,
) {
  return betterAuth({
    database: mongodbAdapter(store.db),
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    socialProviders: {
      google: {
        clientId: googleId,
        clientSecret: googleSecret,
        prompt: 'select_account',
      },
    },
    advanced: {
      database: {
        joins: true,
      },
    },
  })
}

type Auth = ReturnType<typeof createAuth>

const globalStore = globalThis as typeof globalThis & {
  __caddieAuth?: Auth | null
}

export function authConfigured() {
  return Boolean(
    process.env.MONGODB_URI?.trim() &&
      process.env.BETTER_AUTH_SECRET?.trim() &&
      process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  )
}

export function authBaseUrl() {
  return process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:5173'
}

/**
 * Google-only auth. The instance is lazy so a missing database or OAuth key
 * shows a clear configuration error instead of crashing the classifier.
 */
export function getAuth(): Auth | null {
  if (globalStore.__caddieAuth !== undefined) return globalStore.__caddieAuth

  const store = mongo()
  const secret = process.env.BETTER_AUTH_SECRET?.trim()
  const googleId = process.env.GOOGLE_CLIENT_ID?.trim()
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()

  if (!store || !secret || !googleId || !googleSecret) {
    console.warn(
      '[auth] disabled: set MONGODB_URI, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
    )
    globalStore.__caddieAuth = null
    return null
  }

  const auth = createAuth(store, secret, googleId, googleSecret, authBaseUrl())
  globalStore.__caddieAuth = auth
  return auth
}

export type AuthSession = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>
