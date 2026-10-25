import { findApplicationEmail } from '../shared/application-email'
import type { ApplicationDetail } from '../shared/account'
import type { CvStory, FitGap } from '../shared/cv-fit'
import type { CompanyProfile } from '../shared/jd-classification'
import { matchRequirements, scoreRequirements } from '../src/lib/match'
import {
  AccountError,
  createApplication,
  getApplication,
  getApplicationFile,
  listStories,
  saveApplicationCv,
  updateApplication,
} from './account'
import { classifyJd } from './classify'
import { composeApplication } from './compose'
import { extractPdfText } from './cv/text'
import { classifyCvDocxFast } from './cv/fast'
import { editDocx } from './cv/docx'
import { planCv } from './cv/plan'
import { renderDocxToPdf } from './cv/render'
import { readConfig } from './env'
import { researchCompany } from './research'
import { validateJd } from './validate'

const MAX_JD = 40_000
const MIN_JD = 40

export type PipelineProgress = (message: string) => void | Promise<void>

export type PreparedApplication = {
  application: ApplicationDetail
  coverage: {
    coverage: number | null
    matched: number
    total: number
    gaps: string[]
    related: string[]
  }
  recipient: string | null
  cvNote: string
  research: CompanyProfile | null
}

function cleanJd(value: string) {
  const text = value.replace(/\r\n/g, '\n').trim()
  if (text.length < MIN_JD) {
    throw new AccountError('Paste a job description first.', 400)
  }
  if (text.length > MAX_JD) {
    throw new AccountError('That posting is too long. Trim it below 40,000 characters.', 413)
  }
  return text
}

function mustGaps(
  cvText: string,
  jd: NonNullable<ApplicationDetail['classification']>['data'],
): FitGap[] {
  return matchRequirements(cvText, jd.requirements)
    .filter((entry) => entry.requirement.importance === 'must' && !entry.covered)
    .map((entry) => ({
      label: entry.requirement.label || entry.missingTerms.join(' or '),
      terms: entry.missingTerms,
      kind: 'must' as const,
    }))
    .filter((gap) => gap.label)
    .slice(0, 16)
}

async function tailorCv(input: {
  userId: string
  application: ApplicationDetail
  jd: NonNullable<ApplicationDetail['classification']>['data']
  company: CompanyProfile | null
  stories: CvStory[]
  onProgress?: PipelineProgress
}) {
  if (input.application.cv.kind !== 'docx') {
    return 'The base CV is a PDF, so it was kept as-is for this application.'
  }

  const config = readConfig()
  const docxFile = await getApplicationFile(input.userId, input.application.id, 'docx')
  const cvClass = await classifyCvDocxFast(docxFile.buffer, config)
  const pdfFile = await getApplicationFile(input.userId, input.application.id, 'pdf')
  const cvText = await extractPdfText(pdfFile.buffer)
  const gaps = mustGaps(cvText, input.jd)

  const plan = await planCv(
    {
      docx: Buffer.from(docxFile.buffer).toString('base64'),
      cv: cvClass.data,
      jd: input.jd,
      company: input.company,
      gaps,
      message:
        'Improve this CV for the role using only facts already present in the CV and the approved experiences. Prefer whole-block replacements that fill the existing line. Do not invent roles, tools, metrics or outcomes.',
      stories: input.stories.slice(0, 6),
      history: [],
    },
    config,
  )

  if (plan.type === 'question') {
    return `I did not change the CV this time: ${plan.question}`
  }
  if (plan.type === 'no-fit') {
    return `I kept the CV as-is: ${plan.reason}`
  }

  await input.onProgress?.('Tailoring the CV…')
  const edited = await editDocx(
    docxFile.buffer,
    plan.edits.map((edit) => ({ blockId: edit.blockId, text: edit.text })),
  )
  const pdf = await renderDocxToPdf(edited.docx)
  await saveApplicationCv(input.userId, input.application.id, {
    docx: edited.docx,
    pdf,
  })

  return plan.edits.length > 0
    ? `Tailored ${plan.edits.length} CV ${plan.edits.length === 1 ? 'line' : 'lines'} while keeping the layout.`
    : 'The CV was kept as-is.'
}

export async function prepareApplication(
  userId: string,
  jdText: string,
  options: {
    onProgress?: PipelineProgress
    applicantName?: string | null
  } = {},
): Promise<PreparedApplication> {
  const jd = cleanJd(jdText)
  const config = readConfig()
  const validation = await validateJd(jd, config)
  if (!validation.allowed) {
    throw new AccountError(validation.reason || 'That does not look like a job posting.', 422)
  }

  await options.onProgress?.('Opening the application…')
  let application = await createApplication(userId, jd)

  await options.onProgress?.('Reading the role…')
  const classification = await classifyJd(jd, 'gemma')
  application = await updateApplication(userId, application.id, { classification })
  const data = classification.data

  let research: CompanyProfile | null = null
  if (data.company.name) {
    await options.onProgress?.('Reading the company…')
    try {
      research = (
        await researchCompany(
          {
            company: data.company.name,
            role: data.role.title ?? '',
            fields: data.role.fields,
            summary: data.summary,
          },
          config,
        )
      ).profile
    } catch {
      // Company research is useful context, never a blocker.
    }
  }

  const pdfFile = await getApplicationFile(userId, application.id, 'pdf')
  const cvText = await extractPdfText(pdfFile.buffer)
  const score = scoreRequirements(cvText, jd, data.requirements, data.signals)

  await options.onProgress?.('Tailoring the CV…')
  let cvNote = 'The CV was kept as-is.'
  if (application.cv.hasDocx) {
    try {
      const stories = await listStories(userId)
      cvNote = await tailorCv({
        userId,
        application,
        jd: data,
        company: research,
        stories,
        onProgress: options.onProgress,
      })
    } catch (error) {
      cvNote = `The CV could not be tailored: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    }
  }

  await options.onProgress?.('Writing the cover letter…')
  application = await composeApplication(
    userId,
    application.id,
    'cover-letter',
    options.applicantName ?? null,
  )

  await options.onProgress?.('Writing the email…')
  application = await composeApplication(
    userId,
    application.id,
    'email',
    options.applicantName ?? null,
  )

  const recipient = findApplicationEmail(jd)
  if (recipient && application.emailDraft) {
    application = await updateApplication(userId, application.id, {
      emailDraft: { ...application.emailDraft, to: recipient },
    })
  }

  const finalApplication = await getApplication(userId, application.id)
  return {
    application: finalApplication,
    coverage: {
      coverage: score.coverage,
      matched: score.matched,
      total: score.total,
      gaps: score.gaps.map((gap) => gap.term),
      related: score.related.map((gap) => gap.term),
    },
    recipient,
    cvNote,
    research,
  }
}
