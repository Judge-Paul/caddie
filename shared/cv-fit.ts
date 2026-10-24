import type { CvClassification } from './cv-classification'
import type { CompanyProfile, JdClassification } from './jd-classification'

/**
 * A fact the candidate told us about their own work. Stories are kept in the
 * browser profile so a later JD can reuse confirmed evidence without asking
 * again. They are never written to a server database.
 */
export type CvStory = {
  id: string
  roleId: string | null
  company: string | null
  title: string | null
  gapLabel: string | null
  skills: string[]
  /** The candidate's own wording; keep it for future JDs. */
  userText: string
  /** The approved CV bullet, when the story was applied. */
  bullet: string | null
  /** The short conversation that produced it, kept for future context. */
  history?: FitMessage[]
  createdAt: string
  updatedAt: string
}

export type FitGap = {
  label: string
  terms: string[]
  kind: 'must' | 'related'
}

export type FitMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type FitRequest = {
  /** Base64 DOCX source; needed to validate rendered line counts. */
  docx: string
  cv: CvClassification
  jd: JdClassification
  company: CompanyProfile | null
  gap: FitGap
  roleId: string
  message: string
  history?: FitMessage[]
  stories?: CvStory[]
  /** Bullets already rejected in this conversation. */
  excludeBlockIds?: string[]
}

export type FitLineCount = {
  before: number
  after: number
  pagesBefore: number
  pagesAfter: number
}

export type FitProposal = {
  type: 'proposal'
  gapLabel: string
  role: { id: string; company: string | null; title: string | null }
  bullet: string
  target: { blockId: string; text: string }
  rationale: string
  factsUsed: string[]
  lineCount: FitLineCount
}

export type FitQuestion = {
  type: 'question'
  question: string
}

export type FitNoFit = {
  type: 'no-fit'
  reason: string
}

export type FitResponse = FitProposal | FitQuestion | FitNoFit
