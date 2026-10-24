import type { ApplicationDetail, SendApplicationInput } from '../shared/account'
import {
  AccountError,
  getApplication,
  getApplicationFile,
  markApplicationSent,
  updateApplication,
} from './account'
import { sendResendEmail } from './resend'
import { sendingForSend } from './sending'

function cleanEmail(value: string) {
  const email = value.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccountError('Enter a valid recipient email address.', 400)
  }
  return email
}

export async function sendApplication(
  userId: string,
  id: string,
  input: SendApplicationInput,
): Promise<ApplicationDetail> {
  const to = cleanEmail(input.to)
  const subject = input.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  const body = input.body.trim()

  if (!subject) throw new AccountError('Add a subject before sending.', 400)
  if (body.length < 20) throw new AccountError('Add a message before sending.', 400)
  if (body.length > 20_000) throw new AccountError('That email is too long.', 413)

  const application = await getApplication(userId, id)
  if (application.sentAt || application.completedAt) {
    throw new AccountError('This application is locked after sending or completion.', 409)
  }
  const sending = await sendingForSend(userId)
  await updateApplication(userId, id, {
    emailDraft: {
      to,
      subject,
      body,
      updatedAt: '',
    },
  })
  const from = sending.fromName
    ? `${sending.fromName} <${sending.email}>`
    : sending.email

  const attachmentPayload: { filename: string; content: string }[] = []
  if (input.attachCv) {
    const file = await getApplicationFile(userId, id, 'pdf')
    attachmentPayload.push({
      filename: file.fileName,
      content: Buffer.from(file.buffer).toString('base64'),
    })
  }

  const sent = await sendResendEmail({
    apiKey: sending.apiKey,
    from,
    to,
    subject,
    text: body,
    attachments: attachmentPayload.length ? attachmentPayload : undefined,
  })

  if (!sent.id) {
    throw new AccountError('Resend did not confirm the send.', 502)
  }

  console.log('[send] application email accepted', {
    applicationId: application.id,
    resendId: sent.id,
  })

  return markApplicationSent(userId, id, to)
}
