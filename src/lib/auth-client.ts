import { createAuthClient } from 'better-auth/react'

/**
 * Same-origin auth client. In dev Vite proxies /api/auth to the Bun server;
 * in production the API and app are served from the same origin.
 */
export const authClient = createAuthClient()

export const { useSession, signIn, signOut } = authClient
