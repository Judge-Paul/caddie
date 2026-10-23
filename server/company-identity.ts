import { companyKey, type Sector } from '../shared/jd-classification'
import { readCache, writeCache } from './cache'

const NAMESPACE = 'company-identity-v1'
const TTL_MS = 90 * 24 * 60 * 60 * 1000

type Identity = { sectors: Sector[] }

/** Remember the product sectors across different postings for one company. */
export async function identitySectors(name: string | null): Promise<Sector[] | null> {
  if (!name) return null
  const identity = await readCache<Identity>(NAMESPACE, companyKey(name), TTL_MS)
  return identity?.sectors ?? null
}

export async function rememberIdentity(
  name: string | null,
  sectors: Sector[],
): Promise<void> {
  if (!name || sectors.length === 0) return
  await writeCache<Identity>(NAMESPACE, companyKey(name), { sectors })
}
