import type { ApplicationStage, ApplicationSummary } from '@shared/account'

type StageSource = Pick<
  ApplicationSummary,
  'status' | 'hasCoverLetter' | 'hasEmailDraft' | 'completedAt' | 'sentAt'
>

export function applicationStage(application: StageSource): ApplicationStage {
  if (application.sentAt) return 'sent'
  if (application.completedAt) return 'completed'
  if (application.hasEmailDraft) return 'ready'
  if (application.status === 'customized') return 'tailored'
  if (application.status === 'classified') return 'reading'
  return 'draft'
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  draft: 'Draft',
  reading: 'Posting read',
  tailored: 'CV tailored',
  ready: 'Ready to send',
  completed: 'Completed',
  sent: 'Sent',
}

export function stageClass(stage: ApplicationStage) {
  if (stage === 'sent') return 'bg-success/10 text-success'
  if (stage === 'completed') return 'bg-ink/5 text-ink'
  if (stage === 'ready') return 'bg-brand-50 text-brand-700'
  if (stage === 'tailored') return 'bg-brand-50/70 text-brand-700'
  if (stage === 'reading') return 'bg-muted text-muted-foreground'
  return 'bg-muted text-muted-foreground'
}

export function stageDot(stage: ApplicationStage) {
  if (stage === 'sent' || stage === 'completed' || stage === 'ready') return 'bg-success'
  if (stage === 'tailored' || stage === 'reading') return 'bg-brand-500'
  return 'bg-muted-foreground/40'
}
