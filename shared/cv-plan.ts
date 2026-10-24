import type { CvClassification } from './cv-classification'
import type { CvStory, FitGap, FitLineCount, FitMessage } from './cv-fit'
import type { CompanyProfile, JdClassification } from './jd-classification'

export type CvPlanEdit = {
  blockId: string
  targetText: string
  text: string
  roleId: string | null
  projectId: string | null
  targetLabel: string
  gapLabels: string[]
  rationale: string
}

export type CvPlan = {
  type: 'plan'
  edits: CvPlanEdit[]
  lineCount: FitLineCount
  protectedCount: number
  note: string
}

export type CvPlanQuestion = {
  type: 'question'
  question: string
}

export type CvPlanNoFit = {
  type: 'no-fit'
  reason: string
}

export type CvPlanResponse = CvPlan | CvPlanQuestion | CvPlanNoFit

export type CvPlanRequest = {
  docx: string
  cv: CvClassification
  jd: JdClassification
  company: CompanyProfile | null
  gaps: FitGap[]
  message: string
  history?: FitMessage[]
  stories?: CvStory[]
  excludeBlockIds?: string[]
}
