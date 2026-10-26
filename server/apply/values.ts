import { EEO_DECLINE, type ApplicantProfile } from '../../shared/account'
import type { ProfileKey } from './map'

export type FillContext = {
  profile: ApplicantProfile | null
  fullName: string | null
  email: string | null
}

/** Plain text for text-like inputs. Files and option lists are handled by the actor. */
export function resolveTextValue(key: ProfileKey, ctx: FillContext): string | null {
  const profile = ctx.profile
  switch (key) {
    case 'name':
      return ctx.fullName
    case 'email':
      return ctx.email
    case 'phone':
    case 'city':
    case 'country':
    case 'address':
    case 'salary':
    case 'noticePeriod':
    case 'linkedin':
      return profile?.[key] ?? null
    case 'eeoGender':
    case 'eeoVeteran':
    case 'eeoDisability':
    case 'eeoRace':
      return profile?.[key] ?? null
    default:
      return null
  }
}

const AUTHORIZATION_OPTIONS: Record<string, string[]> = {
  citizen: ['citizen'],
  permanent_resident: ['permanent resident', 'green card', 'lawful permanent'],
  authorized_no_sponsorship: ['authorized', 'no sponsorship', 'legally authorized'],
  needs_sponsorship: ['sponsorship', 'require sponsorship', 'will need'],
}

function containsAny(haystack: string, needles: string[]) {
  const lower = haystack.toLowerCase()
  return needles.some((needle) => lower.includes(needle))
}

/**
 * Picks the option that carries the candidate's answer. Never invents: no
 * confident match means null and the run pauses instead of guessing.
 */
export function matchFieldOption(
  options: string[],
  key: ProfileKey,
  ctx: FillContext,
  fieldLabel: string,
): string | null {
  if (options.length === 0) return null

  if (
    key === 'eeoGender' ||
    key === 'eeoVeteran' ||
    key === 'eeoDisability' ||
    key === 'eeoRace'
  ) {
    const stored = ctx.profile?.[key]
    if (!stored) return null
    if (stored === EEO_DECLINE) {
      return options.find((option) => /declin/i.test(option)) ?? null
    }
    return options.find((option) =>
      option.toLowerCase().includes(stored.toLowerCase()),
    ) ?? null
  }

  if (key === 'authorization' && ctx.profile?.authorization) {
    const label = fieldLabel.toLowerCase()
    if (label.includes('sponsor')) {
      const needs = ctx.profile.authorization === 'needs_sponsorship'
      return (
        options.find((option) =>
          needs ? /^y(es)?\b/i.test(option.trim()) : /^n(o)?\b/i.test(option.trim()),
        ) ?? null
      )
    }
    const candidates = AUTHORIZATION_OPTIONS[ctx.profile.authorization] ?? []
    return options.find((option) => containsAny(option, candidates)) ?? null
  }

  const text = resolveTextValue(key, ctx)
  if (!text) return null
  const exact = options.find(
    (option) => option.trim().toLowerCase() === text.trim().toLowerCase(),
  )
  if (exact) return exact
  return options.find((option) => containsAny(option, [text])) ?? null
}

export function splitName(fullName: string | null): { first: string | null; last: string | null } {
  if (!fullName) return { first: null, last: null }
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

/** Split-name aware text for a field. Separate first/last inputs each take their part. */
export function textForField(
  label: string,
  key: ProfileKey,
  ctx: FillContext,
): string | null {
  if (key === 'name') {
    const { first, last } = splitName(ctx.fullName)
    if (/first|given/i.test(label)) return first
    if (/last|family|surname/i.test(label)) return last
    return ctx.fullName
  }
  return resolveTextValue(key, ctx)
}
