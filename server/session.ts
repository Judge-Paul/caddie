import { createMiddleware } from 'hono/factory'

import { getAuth, type AuthSession } from './auth'

export type AppEnv = {
  Variables: {
    session: AuthSession
  }
}

/** Every data route is account-scoped; auth and health stay public. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth()

  if (!auth) {
    return c.json(
      {
        error:
          'Accounts are not configured yet. Add MONGODB_URI, BETTER_AUTH_SECRET and the Google keys to .env.local.',
      },
      503,
    )
  }

  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Sign in required.' }, 401)

    c.set('session', session)
    await next()
  } catch (error) {
    console.error('[auth] session lookup failed', error)
    return c.json({ error: 'Could not reach the account database.' }, 503)
  }
})
