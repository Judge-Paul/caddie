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

export type ApplicationSummary = {
  id: string
  title: string | null
  company: string | null
  status: ApplicationStatus
  cv: AccountCv
  createdAt: string
  updatedAt: string
}

export type ApplicationDetail = ApplicationSummary & {
  jdText: string
  classification: ClassificationResult | null
}

export type AccountMe = {
  user: AccountUser
  cv: AccountCv | null
  applications: ApplicationSummary[]
  stories: CvStory[]
}

export type CreateApplicationInput = {
  jdText: string
}

export type UpdateApplicationPatch = {
  jdText?: string
  classification?: ClassificationResult | null
  status?: ApplicationStatus
}
