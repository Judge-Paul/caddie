import type { ClefQuestion } from '../cloudflare'
import { runClef } from '../cloudflare'
import type { ServerConfig } from '../env'
import { applicantForFill } from '../applicant'
import type { ApplicantProfile } from '../../shared/account'
import { closeApplySession, openApplySession } from './session'
import { snapshotForm, type RawField, type RawSnapshot } from './fields'

export type ProfileKey =
  | 'name'
  | 'email'
  | 'phone'
  | 'city'
  | 'country'
  | 'address'
  | 'authorization'
  | 'salary'
  | 'noticePeriod'
  | 'linkedin'
  | 'eeoGender'
  | 'eeoVeteran'
  | 'eeoDisability'
  | 'eeoRace'
  | 'cv_file'
  | 'cover_letter_file'

export const PROFILE_KEY_CRITERIA: Record<ProfileKey | 'none', string> = {
  name: 'The field asks for the candidate name, first name, last name or full name.',
  email: 'The field asks for an email address.',
  phone: 'The field asks for a phone or mobile number.',
  city: 'The field asks for a city or town, not a full address.',
  country: 'The field asks for a country.',
  address: 'The field asks for a street address, postal code, zip or full location.',
  authorization:
    'The field asks about work authorization, the right to work, a visa, or whether sponsorship is needed.',
  salary: 'The field asks for salary expectations or desired pay.',
  noticePeriod: 'The field asks for a notice period, availability or start date.',
  linkedin: 'The field asks for a LinkedIn profile, website, portfolio or social link.',
  eeoGender: 'The equal-opportunity question asks about gender.',
  eeoVeteran: 'The equal-opportunity question asks about veteran status.',
  eeoDisability: 'The equal-opportunity question asks about disability.',
  eeoRace: 'The equal-opportunity question asks about race or ethnicity.',
  cv_file: 'A file upload for the CV or resume.',
  cover_letter_file: 'A file upload for the cover letter.',
  none: 'Anything else: logins, captchas, search boxes, unrelated questions, or fields with no candidate answer.',
}

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio-group'
  | 'file'
  | 'other'

export type MappedField = {
  /** Snapshot ref, stamped on the element for the fill step. */
  ref: number
  label: string
  kind: FieldKind
  required: boolean
  options?: string[]
  profileKey: ProfileKey | null
  confidence: number
  /** The profile holds a value (or an explicit decline) for this key. */
  hasValue: boolean
  /** Required, but nothing to fill it with. */
  needsYou: boolean
}

export type FormMap = {
  url: string
  title: string
  fields: MappedField[]
  fileUploads: { cv: boolean; coverLetter: boolean }
  submitFound: boolean
}

export const MAP_CONFIDENCE = 0.45

const BATCH = 16

function kindOf(field: RawField): FieldKind {
  if (field.inputType === 'radio-group') return 'radio-group'
  if (field.inputType === 'checkbox') return 'checkbox'
  if (field.inputType === 'file') return 'file'
  if (field.tag === 'select') return 'select'
  if (field.tag === 'textarea') return 'textarea'
  if (field.inputType === 'email') return 'email'
  if (field.inputType === 'tel') return 'tel'
  if (field.tag === 'input') return 'text'
  return 'other'
}

function describeField(field: RawField) {
  const parts = [
    `${field.tag}${field.inputType ? `[${field.inputType}]` : ''}`,
    `"${field.label || 'unlabeled'}"`,
  ]
  if (field.required) parts.push('required')
  if (field.options?.length) parts.push(`options: ${field.options.slice(0, 12).join(' | ')}`)
  if (field.inputType === 'file' && field.accept) parts.push(`accepts: ${field.accept}`)
  return parts.join(' ')
}

export function buildClefQuestions(fields: RawField[]): Record<string, ClefQuestion> {
  const questions: Record<string, ClefQuestion> = {}
  for (const field of fields) {
    questions[`f${field.ref}`] = {
      type: 'choice',
      instructions: `Which applicant detail fills this application-form field? ${describeField(field)}`,
      criteria: PROFILE_KEY_CRITERIA,
    }
  }
  return questions
}

function keyHasValue(key: ProfileKey, profile: ApplicantProfile | null): boolean {
  if (!profile) return false
  switch (key) {
    case 'name':
    case 'email':
      return true
    case 'cv_file':
    case 'cover_letter_file':
      return true
    default:
      return profile[key] !== null
  }
}

export function applyClefAnswers(
  snapshot: Pick<RawSnapshot, 'fields'>,
  answers: Record<string, { type: string; choice?: string; confidence?: number }>,
  profile: ApplicantProfile | null,
): MappedField[] {
  return snapshot.fields.map((field) => {
    const answer = answers[`f${field.ref}`]
    const choice =
      answer?.type === 'choice' && answer.choice && answer.choice in PROFILE_KEY_CRITERIA
        ? (answer.choice as ProfileKey | 'none')
        : null
    const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
    const profileKey = choice && choice !== 'none' && confidence >= MAP_CONFIDENCE ? choice : null
    const hasValue = profileKey !== null && keyHasValue(profileKey, profile)
    return {
      ref: field.ref,
      label: field.label || `${field.tag} field`,
      kind: kindOf(field),
      required: field.required,
      ...(field.options?.length ? { options: field.options } : {}),
      profileKey,
      confidence,
      hasValue,
      needsYou: field.required && (!profileKey || !hasValue),
    }
  })
}

function stateText(snapshot: RawSnapshot) {
  return [
    `Page: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    'Fields:',
    ...snapshot.fields.map(
      (field, index) => `${index + 1}. ${describeField(field)}`,
    ),
  ].join('\n')
}

function fileUploads(fields: MappedField[]) {
  const file = (key: ProfileKey) =>
    fields.some((field) => field.kind === 'file' && field.profileKey === key)
  return { cv: file('cv_file'), coverLetter: file('cover_letter_file') }
}

/**
 * v0: read-only. Opens the form, maps every field to an applicant detail
 * (or flags it), then closes the session. Never fills, never submits.
 */
export async function mapApplicationForm(
  config: ServerConfig,
  input: { userId: string; url: string },
): Promise<FormMap> {
  const session = await openApplySession(config, input.url)
  try {
    const snapshot = await snapshotForm(session.page)
    const profile = await applicantForFill(input.userId).catch(() => null)

    const fields: MappedField[] = []
    for (let start = 0; start < snapshot.fields.length; start += BATCH) {
      const batch = snapshot.fields.slice(start, start + BATCH)
      const result = await runClef(config, {
        state: stateText({ ...snapshot, fields: batch }),
        questions: buildClefQuestions(batch),
      })
      fields.push(...applyClefAnswers({ fields: batch }, result.answers, profile))
    }

    return {
      url: snapshot.url,
      title: snapshot.title,
      fields,
      fileUploads: fileUploads(fields),
      submitFound: snapshot.submits.length > 0,
    }
  } finally {
    await closeApplySession(config, session)
  }
}
