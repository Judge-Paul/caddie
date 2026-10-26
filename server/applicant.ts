import { AccountError } from './account'
import { decryptSecret, encryptSecret, SecretError } from './crypto'
import { mongo } from './mongo'
import {
  EEO_DECLINE,
  type ApplicantProfile,
  type SaveApplicantProfileInput,
  type WorkAuthorization,
} from '../shared/account'

const AUTHORIZATIONS: WorkAuthorization[] = [
  'citizen',
  'permanent_resident',
  'authorized_no_sponsorship',
  'needs_sponsorship',
]

function clean(value: unknown, max: number, field: string) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new AccountError(`Enter ${field} as text.`, 400)
  }
  const text = value.trim()
  if (!text) return null
  if (text.length > max) {
    throw new AccountError(`That ${field} is too long.`, 400)
  }
  return text
}

function cleanLinkedin(value: unknown) {
  const text = clean(value, 240, 'LinkedIn address')
  if (!text) return null
  if (/\s/.test(text)) {
    throw new AccountError('Enter the LinkedIn address without spaces.', 400)
  }
  return text
}

function cleanAuthorization(value: unknown): WorkAuthorization | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !AUTHORIZATIONS.includes(value as WorkAuthorization)) {
    throw new AccountError('Choose a work authorization option.', 400)
  }
  return value as WorkAuthorization
}

function cleanEeo(value: unknown, field: string) {
  const text = clean(value, 80, field)
  if (!text) return null
  if (text === EEO_DECLINE) return EEO_DECLINE
  return text
}

export function normaliseApplicant(input: SaveApplicantProfileInput): ApplicantProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AccountError('Add the application details first.', 400)
  }
  return {
    phone: clean(input.phone, 40, 'phone number'),
    city: clean(input.city, 120, 'city'),
    country: clean(input.country, 120, 'country'),
    address: clean(input.address, 240, 'street address'),
    authorization: cleanAuthorization(input.authorization),
    salary: clean(input.salary, 80, 'salary expectation'),
    noticePeriod: clean(input.noticePeriod, 80, 'notice period'),
    linkedin: cleanLinkedin(input.linkedin),
    eeoGender: cleanEeo(input.eeoGender, 'gender answer'),
    eeoVeteran: cleanEeo(input.eeoVeteran, 'veteran answer'),
    eeoDisability: cleanEeo(input.eeoDisability, 'disability answer'),
    eeoRace: cleanEeo(input.eeoRace, 'race or ethnicity answer'),
  }
}

function store() {
  const db = mongo()?.db
  if (!db) {
    throw new AccountError('Accounts are not configured yet. Add MONGODB_URI to .env.local.', 503)
  }
  return db.collection<{ userId: string; applicantCiphertext?: string | null }>('profiles')
}

function readCiphertext(doc: { applicantCiphertext?: string | null } | null): ApplicantProfile | null {
  const ciphertext = doc?.applicantCiphertext
  if (!ciphertext) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptSecret(ciphertext))
  } catch (error) {
    if (error instanceof SecretError) throw error
    throw new SecretError('The stored application details are unreadable. Save them again.')
  }
  return normaliseApplicant((parsed ?? {}) as SaveApplicantProfileInput)
}

export async function getApplicant(userId: string): Promise<ApplicantProfile | null> {
  return readCiphertext(await store().findOne({ userId }))
}

/** Decrypts for the server-side form filler. Never send this to the browser except in Profile. */
export async function applicantForFill(userId: string): Promise<ApplicantProfile | null> {
  return getApplicant(userId)
}

export async function saveApplicant(
  userId: string,
  input: SaveApplicantProfileInput,
): Promise<ApplicantProfile> {
  const profile = normaliseApplicant(input)
  if (Object.values(profile).every((value) => value === null)) {
    throw new AccountError('Add at least one detail before saving.', 400)
  }
  const collection = store()
  await collection.updateOne(
    { userId },
    {
      $set: { applicantCiphertext: encryptSecret(JSON.stringify(profile)), updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  )
  return profile
}

export async function deleteApplicant(userId: string): Promise<null> {
  await store().updateOne({ userId }, { $unset: { applicantCiphertext: '' } })
  return null
}
