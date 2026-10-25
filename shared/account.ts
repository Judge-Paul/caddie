import type { CvStory } from './cv-fit'
import type { ClassificationResult } from './jd-classification'

export type AccountUser = {
  id: string
  name: string
  email: string
  image: string | null
}

export type AccountCvKind = 'docx' | 'pdf'

export type AccountCv = {
  kind: AccountCvKind
  fileName: string
  hasDocx: boolean
  hasPdf: boolean
  updatedAt: string
}

export type ApplicationStatus = 'draft' | 'classified' | 'customized'

export type ApplicationStage =
  | 'draft'
  | 'reading'
  | 'tailored'
  | 'ready'
  | 'completed'
  | 'sent'

export type CoverLetterDraft = {
  text: string
  updatedAt: string
}

export type EmailDraft = {
  to: string
  subject: string
  body: string
  updatedAt: string
}

export type PublicWorkKind = 'website' | 'github'

export type PublicWorkProject = {
  name: string
  description: string | null
  url: string | null
  skills: string[]
}

export type PublicWorkSource = {
  kind: PublicWorkKind
  url: string
  label: string | null
  headline: string | null
  summary: string | null
  skills: string[]
  projects: PublicWorkProject[]
  readAt: string | null
  error: string | null
}

export type PublicWork = {
  website: PublicWorkSource | null
  github: PublicWorkSource | null
  updatedAt: string | null
}

export type SavePublicWorkInput = {
  website: string | null
  github: string | null
}

export type TelegramStatus = {
  connected: boolean
  botUrl: string | null
  username: string | null
  firstName: string | null
  autoApply: boolean
  linkedAt: string | null
}

export type SendingSettings = {
  email: string | null
  fromName: string | null
  domain: string | null
  hasKey: boolean
  keyLast4: string | null
  verified: boolean
  verifiedAt: string | null
}

export type ApplicationSummary = {
  id: string
  title: string | null
  company: string | null
  status: ApplicationStatus
  cv: AccountCv
  hasCoverLetter: boolean
  hasEmailDraft: boolean
  completedAt: string | null
  sentAt: string | null
  sentTo: string | null
  createdAt: string
  updatedAt: string
}

export type ApplicationDetail = ApplicationSummary & {
  jdText: string
  classification: ClassificationResult | null
  coverLetter: CoverLetterDraft | null
  emailDraft: EmailDraft | null
}

export type AccountMe = {
  user: AccountUser
  cv: AccountCv | null
  applications: ApplicationSummary[]
  stories: CvStory[]
  publicWork: PublicWork
  telegram: TelegramStatus
  sending: SendingSettings
}

export type CreateApplicationInput = {
  jdText: string
}

export type UpdateApplicationPatch = {
  jdText?: string
  classification?: ClassificationResult | null
  status?: ApplicationStatus
  coverLetter?: CoverLetterDraft | null
  emailDraft?: EmailDraft | null
}

export type SaveSendingInput = {
  email: string
  fromName?: string | null
  /** Only sent when the user adds or replaces the key. */
  apiKey?: string
}

export type SendApplicationInput = {
  to: string
  subject: string
  body: string
  attachCv: boolean
  attachCoverLetter?: boolean
}

export type ComposeKind = 'cover-letter' | 'email'

export type ComposeApplicationInput = {
  kind: ComposeKind
}
