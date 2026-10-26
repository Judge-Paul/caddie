import { AccountError, getApplication, getApplicationFile, markFormApplied } from '../account'
import { applicantForFill } from '../applicant'
import { runClef } from '../cloudflare'
import { renderCoverLetterPdf } from '../cover-letter'
import type { ServerConfig } from '../env'
import { decideFields, MAP_CONFIDENCE, type MappedField } from './map'
import { snapshotForm } from './fields'
import {
  clickSubmit,
  detectBlockers,
  pace,
  performFill,
  selectRemoteFile,
  takeScreenshot,
  uploadSessionFile,
  visibleText,
  type FillAction,
} from './act'
import { closeApplySession, openApplySession } from './session'
import { matchFieldOption, textForField, type FillContext } from './values'

export class FormNeedsHuman extends AccountError {
  readonly liveUrl: string

  constructor(message: string, liveUrl: string) {
    super(message, 422)
    this.name = 'FormNeedsHuman'
    this.liveUrl = liveUrl
  }
}

export type ApplyResult = {
  confirmation: string
  screenshots: Uint8Array[]
  fieldsFilled: number
  fieldsTotal: number
}

const READINESS_QUESTION = {
  type: 'choice' as const,
  instructions:
    'After pressing submit, did the job application go through? Use the page text and whether a form is still showing.',
  criteria: {
    submitted:
      'A confirmation that the application was received: thank-you message, reference or confirmation number, or success notice. The form is gone or replaced.',
    blocked:
      'An error, captcha, login wall, or the unchanged form with validation errors. Nothing was submitted.',
    needs_human:
      'Anything else: an unclear state, additional steps, or missing information.',
  },
}

const CONFIRMATION_PATTERN =
  /thank you|thanks for applying|application (received|submitted|complete)|successfully submitted|confirmation|reference (number|#|no)|we received your application/i

function actionFor(
  field: MappedField,
  profileKey: NonNullable<MappedField['profileKey']>,
  ctx: FillContext,
): FillAction | null {
  if (field.kind === 'checkbox') return { type: 'check' }
  if (field.kind === 'select' || field.kind === 'radio-group') {
    const option = matchFieldOption(field.options ?? [], profileKey, ctx, field.label)
    if (!option) return null
    return field.kind === 'select'
      ? { type: 'select', option }
      : { type: 'radio', option }
  }
  const text = textForField(field.label, profileKey, ctx)
  if (!text) return null
  return { type: 'text', text }
}

export async function applyToForm(
  config: ServerConfig,
  userId: string,
  applicationId: string,
  input: {
    applicantName: string | null
    email: string | null
    onProgress?: (message: string) => void | Promise<void>
  },
): Promise<ApplyResult> {
  const application = await getApplication(userId, applicationId)
  if (!application.form) {
    throw new AccountError('This application has no form to submit.', 409)
  }
  if (application.form.appliedAt) {
    throw new AccountError('This form was already submitted.', 409)
  }

  const profile = await applicantForFill(userId)
  if (!profile) {
    throw new AccountError('Add application details in Profile first.', 409)
  }
  const ctx: FillContext = {
    profile,
    fullName: input.applicantName,
    email: input.email,
  }

  const session = await openApplySession(config, application.form.url)
  try {
    const snapshot = await snapshotForm(session.page)
    if (snapshot.fields.length === 0) {
      throw new FormNeedsHuman(
        'No fillable fields were found on that page. It may need a human look.',
        session.liveUrl,
      )
    }

    await input.onProgress?.('Deciding what each field needs…')
    const fields = await decideFields(config, snapshot, profile)

    const missing = fields.filter((field) => field.needsYou)
    if (missing.length > 0) {
      throw new FormNeedsHuman(
        `The form needs ${missing.map((field) => field.label || field.kind).join(', ')} first. Add it under application details in Profile.`,
        session.liveUrl,
      )
    }

    const blockers = await detectBlockers(session.page)
    if (blockers.passwordFields > 0 || blockers.captchaFrames > 0 || blockers.loginWall) {
      throw new FormNeedsHuman(
        'That form asks for a login or a captcha, which always needs a human. Open it here:',
        session.liveUrl,
      )
    }

    const pdf = await getApplicationFile(userId, applicationId, 'pdf')
    const files: {
      cv?: { fileName: string; bytes: Uint8Array }
      cover?: { fileName: string; bytes: Uint8Array }
    } = {
      cv: {
        fileName: application.cv.fileName.replace(/\.docx$/i, '.pdf'),
        bytes: new Uint8Array(pdf.buffer),
      },
    }
    if (application.coverLetter?.text.trim()) {
      files.cover = {
        fileName: 'Cover-Letter.pdf',
        bytes: new Uint8Array(await renderCoverLetterPdf(application.coverLetter.text)),
      }
    }

    let filled = 0
    for (const field of fields) {
      if (field.kind === 'checkbox' && !field.profileKey) {
        if (!field.required) continue
        await input.onProgress?.(`Checking ${field.label || 'consent'}…`)
        const checked = await performFill(session.page, field.ref, field.kind, {
          type: 'check',
        })
        if (!checked.ok) {
          throw new FormNeedsHuman(
            `"${field.label || field.kind}" could not be checked. It needs a human look:`,
            session.liveUrl,
          )
        }
        filled += 1
        await pace()
        continue
      }
      if (!field.profileKey || field.kind === 'other') continue
      if (field.kind === 'file') {
        const file =
          field.profileKey === 'cv_file'
            ? files.cv
            : field.profileKey === 'cover_letter_file'
              ? files.cover
              : undefined
        if (!file) {
          throw new FormNeedsHuman(
            `No file fits "${field.label || field.kind}". Add it under application details in Profile.`,
            session.liveUrl,
          )
        }
        if (!config.browserbaseKey) {
          throw new AccountError('Form apply needs BROWSERBASE_API_KEY.', 503)
        }
        await input.onProgress?.(`Uploading ${field.label || 'file'}…`)
        const remote = await uploadSessionFile(
          config.browserbaseKey,
          session.id,
          file.fileName,
          file.bytes,
        )
        const attached = await selectRemoteFile(session.page, field.ref, remote)
        if (!attached) {
          throw new FormNeedsHuman(
            `"${field.label || field.kind}" did not take the file. It needs a human look:`,
            session.liveUrl,
          )
        }
        filled += 1
        await pace()
        continue
      }
      const action = actionFor(field, field.profileKey, ctx)
      if (!action) {
        throw new FormNeedsHuman(
          `No answer fits "${field.label || field.kind}". Add it under application details in Profile.`,
          session.liveUrl,
        )
      }
      await input.onProgress?.(`Filling ${field.label || field.kind}…`)
      const result = await performFill(session.page, field.ref, field.kind, action)
      if (!result.ok) {
        throw new FormNeedsHuman(
          `"${field.label || field.kind}" did not take the value. It needs a human look:`,
          session.liveUrl,
        )
      }
      filled += 1
      await pace()
    }

    await input.onProgress?.('Submitting…')
    const preShot = await takeScreenshot(session.page).catch(() => null)
    const submitted = await clickSubmit(session.page, snapshot.submits)
    const postShot = await takeScreenshot(session.page).catch(() => null)
    const screenshots = [preShot, postShot].filter(
      (shot): shot is NonNullable<typeof shot> => shot !== null,
    )

    const text = await visibleText(session.page)
    if (CONFIRMATION_PATTERN.test(text)) {
      await markFormApplied(userId, applicationId)
      return {
        confirmation: text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ') || 'Application submitted.',
        screenshots,
        fieldsFilled: filled,
        fieldsTotal: fields.length,
      }
    }

    const formStillThere = await session.page
      .evaluate<number>(
        `(() => document.querySelectorAll('form input, form select, form textarea').length)()`,
      )
      .then((count) => count > 0)
      .catch(() => true)
    const readiness = await runClef(config, {
      state: [
        `URL: ${submitted.url}`,
        `Page text:\n${text.slice(0, 2_000)}`,
        `Form still showing: ${formStillThere ? 'yes' : 'no'}`,
      ].join('\n'),
      questions: { readiness: READINESS_QUESTION },
    })
    const answer = readiness.answers.readiness
    const ready =
      answer?.type === 'choice' &&
      answer.choice === 'submitted' &&
      (answer.confidence ?? 1) >= MAP_CONFIDENCE

    if (!ready) {
      const reason =
        answer?.type === 'choice' && answer.choice === 'blocked'
          ? 'The form was blocked or showed an error after submit.'
          : 'The result after submit is unclear.'
      throw new FormNeedsHuman(
        `${reason} Check it here:`,
        session.liveUrl,
      )
    }

    await markFormApplied(userId, applicationId)
    return {
      confirmation: text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ') || 'Application submitted.',
      screenshots,
      fieldsFilled: filled,
      fieldsTotal: fields.length,
    }
  } finally {
    await closeApplySession(config, session)
  }
}
