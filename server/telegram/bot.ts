import { Bot, InlineKeyboard, type Context } from 'grammy'

import type { ApplicationDetail } from '../../shared/account'
import { findApplicationEmail } from '../../shared/application-email'
import { prepareApplication, type PreparedApplication } from '../application-pipeline'
import {
  AccountError,
  getApplication,
  getApplicationFile,
  getMe,
  getPublicWork,
  listApplications,
  listStories,
  saveBaseCv,
  savePublicWork,
} from '../account'
import { extractPdfText } from '../cv/text'
import { getSending } from '../sending'
import { scoreRequirements } from '../../src/lib/match'
import { sendApplication } from '../send'
import { ingestCv } from '../cv/ingest'
import { classifyAts } from '../../shared/application-form'
import { applyToForm, FormNeedsHuman } from '../apply/submit'
import { mapApplicationForm, type FormMap } from '../apply/map'
import { createPreviewToken } from '../preview-token'
import { readConfig } from '../env'
import { intakeLinkApplication, LinkNotPostingError } from '../link-intake'
import { consumeRateLimit } from '../rate-limit'
import { TelegramApiError, downloadTelegramFile, sendTelegramPhoto } from './api'
import {
  telegramLinkForChat,
  telegramLinkUrl,
  setTelegramAuto,
  updateTelegramIdentity,
  type TelegramLinkDoc,
} from './links'
import { isBareLink, routeTelegramText } from './router'
import {
  clearTelegramSession,
  getTelegramSession,
  saveTelegramSession,
  telegramUser,
  type TelegramHistoryMessage,
  type TelegramSessionDoc,
} from './store'

const baseUrl = () =>
  (process.env.BETTER_AUTH_URL?.trim() || 'http://localhost:5173').replace(/\/$/, '')

function previewUrl(userId: string, applicationId: string, kind: 'cv' | 'cover-letter') {
  return `${baseUrl()}/api/preview/${createPreviewToken(userId, applicationId, kind)}`
}

function displayName(link: TelegramLinkDoc) {
  return link.username ? `@${link.username}` : link.firstName || 'there'
}

function appName(application: ApplicationDetail) {
  return [application.title, application.company].filter(Boolean).join(' at ') ||
    'your application'
}

function scoreLine(prepared: PreparedApplication) {
  const { coverage } = prepared
  if (coverage.coverage === null) return 'The posting has no must-have requirements to score.'
  return `Coverage: ${coverage.coverage}% (${coverage.matched}/${coverage.total} must-haves).`
}

function gapsLine(prepared: PreparedApplication) {
  return prepared.coverage.gaps.length
    ? `Still missing: ${prepared.coverage.gaps.slice(0, 5).join(', ')}.`
    : 'No must-have gaps were found in the CV.'
}

function linksKeyboard(
  userId: string,
  applicationId: string,
  hasCoverLetter: boolean,
) {
  const keyboard = new InlineKeyboard()
  keyboard.url('Open CV', previewUrl(userId, applicationId, 'cv'))
  if (hasCoverLetter) {
    keyboard.url('Cover letter', previewUrl(userId, applicationId, 'cover-letter'))
  }
  return keyboard
}

function reviewKeyboard(
  userId: string,
  application: ApplicationDetail,
) {
  const keyboard = linksKeyboard(
    userId,
    application.id,
    Boolean(application.coverLetter?.text.trim()),
  )
  keyboard.row()
    .text('Apply now', `apply:${application.id}`)
    .text('Cancel', `cancel:${application.id}`)
  return keyboard
}

async function connectKeyboard(
  chatId: string,
  profile: { username?: string | null; firstName?: string | null },
) {
  const url = await telegramLinkUrl(chatId, profile)
  return url ? new InlineKeyboard().url('Connect Caddie', url) : null
}

async function requireLink(ctx: Context) {
  const chatId = ctx.chat?.id
  if (!chatId) return null
  const link = await telegramLinkForChat(String(chatId))
  if (!link) {
    const keyboard = await connectKeyboard(String(chatId), {
      username: ctx.from?.username ?? null,
      firstName: ctx.from?.first_name ?? null,
    })
    if (!keyboard) {
      await ctx.reply(
        'Caddie is online, but account linking needs BETTER_AUTH_URL set to a public HTTPS address. The current local address cannot be opened from Telegram.',
      )
      return null
    }
    await ctx.reply(
      'Connect this Telegram chat to your Caddie account first. Tap the button below, sign in, then confirm the chat on the site.',
      { reply_markup: keyboard },
    )
    return null
  }
  await updateTelegramIdentity(String(chatId), {
    username: ctx.from?.username ?? null,
    firstName: ctx.from?.first_name ?? null,
  })
  return link
}

async function sessionFor(link: TelegramLinkDoc, chatId: string) {
  return getTelegramSession(chatId, link.userId)
}

async function remember(
  chatId: string,
  link: TelegramLinkDoc,
  session: TelegramSessionDoc | null,
  user: string,
  assistant: string,
) {
  const history: TelegramHistoryMessage[] = [
    ...(session?.history ?? []),
    { role: 'user' as const, content: user.slice(0, 2_000) },
    { role: 'assistant' as const, content: assistant.slice(0, 2_000) },
  ].slice(-10)
  await saveTelegramSession(chatId, link.userId, { history })
}

function formHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function sendPreview(
  ctx: Context,
  link: TelegramLinkDoc,
  prepared: PreparedApplication,
  chatId: string,
  formMap: FormMap | null = null,
) {
  const application = prepared.application
  const recipient =
    prepared.recipient || application.emailDraft?.to.trim() || null
  const email = application.emailDraft
  const form = application.form
  const formLines: string[] =
    form?.supported && !form.appliedAt
      ? [
          `Form: ${formHost(form.url)}`,
          formMap
            ? (() => {
                const needy = formMap.fields.filter((field) => field.needsYou)
                const done = formMap.fields.length - needy.length
                if (needy.length === 0) {
                  return `Form fields: ${done}/${formMap.fields.length} mapped, all covered.`
                }
                return `Form fields: ${done}/${formMap.fields.length} mapped — needs: ${needy.map((field) => field.label || field.kind).slice(0, 4).join(', ')}.`
              })()
            : 'Form detected — field mapping runs when you apply.',
        ]
      : []
  const message = [
    `${appName(application)}`,
    scoreLine(prepared),
    prepared.cvNote,
    gapsLine(prepared),
    ...formLines,
    recipient
      ? `Email: ${recipient}`
      : 'I could not find an application email in the posting.',
    email?.subject ? `Subject: ${email.subject}` : '',
    application.coverLetter?.text.trim()
      ? 'Attachments: CV PDF and cover letter PDF.'
      : 'Attachment: CV PDF.',
  ]
    .filter(Boolean)
    .join('\n\n')

  await saveTelegramSession(chatId, link.userId, {
    activeApplicationId: application.id,
    state: 'awaiting_approval',
    pendingEmail: recipient ? null : '',
  })
  await ctx.reply(message, {
    reply_markup: reviewKeyboard(link.userId, application),
  })
}

async function applyForm(
  ctx: Context,
  link: TelegramLinkDoc,
  applicationId: string,
  chatId: string,
) {
  const quota = consumeRateLimit(`telegram-form:${link.userId}`, 2, 60_000)
  if (!quota.allowed) {
    await ctx.reply(
      `Too many form submissions. Wait ${quota.retryAfter} seconds and try again.`,
    )
    return
  }
  const user = await telegramUser(link)
  if (!user) {
    await ctx.reply('Your Caddie account could not be found. Disconnect and connect Telegram again.')
    return
  }

  await saveTelegramSession(chatId, link.userId, {
    state: 'running',
    activeApplicationId: applicationId,
    pendingEmail: null,
  })
  const status = await ctx.reply('Opening the form and filling it…')
  const edit = async (message: string) => {
    await ctx.api
      .editMessageText(chatId, status.message_id, message)
      .catch(() => {})
  }
  const restore = () =>
    saveTelegramSession(chatId, link.userId, {
      state: 'awaiting_approval',
      activeApplicationId: applicationId,
      pendingEmail: null,
    })

  try {
    const result = await applyToForm(readConfig(), link.userId, applicationId, {
      applicantName: user.name,
      email: user.email,
      onProgress: edit,
    })
    await edit(`Applied via form. ${result.confirmation}`)
    for (const shot of result.screenshots) {
      await sendTelegramPhoto(chatId, shot).catch(() => {})
    }
    await clearTelegramSession(chatId)
  } catch (error) {
    if (error instanceof FormNeedsHuman) {
      await edit(error.message)
      await ctx.reply(error.liveUrl)
      await restore()
      return
    }
    await edit(
      `The form could not be submitted: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
    await restore()
  }
}

async function applyPrepared(
  ctx: Context,
  link: TelegramLinkDoc,
  applicationId: string,
  emailOverride?: string,
  chatId?: string,
) {
  const chat = chatId ?? String(ctx.chat!.id)
  const quota = consumeRateLimit(`telegram-send:${link.userId}`, 5, 60_000)
  if (!quota.allowed) {
    await ctx.reply(
      `Too many send requests. Wait ${quota.retryAfter} seconds and try again.`,
    )
    return
  }
  const application = await getApplication(link.userId, applicationId)
  if (application.form?.supported && !application.form.appliedAt) {
    await applyForm(ctx, link, application.id, chat)
    return
  }
  if (application.sentAt || application.completedAt) {
    await ctx.reply('That application is already locked.')
    return
  }

  const recipient =
    emailOverride?.trim() ||
    application.emailDraft?.to.trim() ||
    findApplicationEmail(application.jdText) ||
    ''
  if (!recipient) {
    await saveTelegramSession(chat, link.userId, {
      activeApplicationId: application.id,
      state: 'awaiting_email',
      pendingEmail: '',
    })
    await ctx.reply(
      'I could not find an application email in the posting. Send the address to use, or say cancel.',
    )
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    await ctx.reply('That does not look like a valid email address.')
    return
  }

  const subject = application.emailDraft?.subject?.trim() || ''
  const body = application.emailDraft?.body?.trim() || ''
  if (!subject || body.length < 20) {
    await ctx.reply(
      'The email draft is not ready yet. Ask me to prepare the application again.',
    )
    return
  }

  await ctx.reply(`Sending to ${recipient}…`)
  try {
    await sendApplication(link.userId, application.id, {
      to: recipient,
      subject,
      body,
      attachCv: true,
      attachCoverLetter: Boolean(application.coverLetter?.text.trim()),
    })
  } catch (error) {
    if (error instanceof AccountError && /resend|sending identity/i.test(error.message)) {
      await saveTelegramSession(chat, link.userId, {
        activeApplicationId: application.id,
        state: 'awaiting_approval',
        pendingEmail: recipient,
      })
      await ctx.reply(
        `Add and verify a sending identity in Caddie Profile before I can apply.\n${baseUrl()}/?view=profile`,
      )
      return
    }
    throw error
  }

  await clearTelegramSession(chat)
  const keyboard = linksKeyboard(
    link.userId,
    application.id,
    Boolean(application.coverLetter?.text.trim()),
  )
  await ctx.reply(
    `Applied to ${appName(application)}.\nTo: ${recipient}\nSubject: ${subject}\n${
      application.coverLetter?.text.trim()
        ? 'Attachments: CV PDF and cover letter PDF.'
        : 'Attachment: CV PDF.'
    }`,
    { reply_markup: keyboard },
  )
}

async function runIntake(
  ctx: Context,
  link: TelegramLinkDoc,
  user: { name: string },
  jdText: string,
  chatId: string,
) {
  const existing = await sessionFor(link, chatId)
  if (existing?.state === 'running') {
    await ctx.reply('I am still working on the previous application. I will message you when it is ready.')
    return
  }

  await saveTelegramSession(chatId, link.userId, {
    state: 'running',
    activeApplicationId: null,
    pendingEmail: null,
  })

  const status = await ctx.reply('Reading the role and preparing the application…')
  const edit = async (message: string) => {
    await ctx.api
      .editMessageText(chatId, status.message_id, message)
      .catch(() => {})
  }

  try {
    const prepared = await prepareApplication(link.userId, jdText, {
      applicantName: user.name,
      onProgress: edit,
    })
    const formMap = await mapForm(link, prepared, edit)
    await deliverPrepared(ctx, link, prepared, chatId, edit, formMap)
  } catch (error) {
    await edit(
      `I could not prepare that application: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
    await clearTelegramSession(chatId)
  }
}

/**
 * Reads the application form when there is one, so review shows the field
 * mapping. Never throws: without a mapping the review simply says so.
 */
async function mapForm(
  link: TelegramLinkDoc,
  prepared: PreparedApplication,
  edit: (message: string) => Promise<void>,
): Promise<FormMap | null> {
  const form = prepared.application.form
  if (!form?.supported || form.appliedAt) return null
  const quota = consumeRateLimit(`telegram-formmap:${link.userId}`, 3, 60_000)
  if (!quota.allowed) return null
  try {
    await edit('Reading the application form…')
    return await mapApplicationForm(readConfig(), {
      userId: link.userId,
      url: form.url,
    })
  } catch {
    return null
  }
}

async function deliverPrepared(
  ctx: Context,
  link: TelegramLinkDoc,
  prepared: PreparedApplication,
  chatId: string,
  edit: (message: string) => Promise<void>,
  formMap: FormMap | null = null,
) {
  const form = prepared.application.form
  if (form?.supported && !form.appliedAt) {
    const needs = (formMap?.fields ?? []).filter((field) => field.needsYou)
    if (link.autoApply && formMap && needs.length === 0) {
      await edit('Ready. Filling the form automatically…')
      await applyPrepared(ctx, link, prepared.application.id, undefined, chatId)
      return
    }
    if (link.autoApply) {
      await saveTelegramSession(chatId, link.userId, {
        activeApplicationId: prepared.application.id,
        state: 'awaiting_approval',
        pendingEmail: null,
      })
      const reason = !formMap
        ? 'I could not read the form fields.'
        : `The form still needs ${needs.map((field) => field.label || field.kind).slice(0, 4).join(', ')}.`
      await edit('Application ready for review.')
      await ctx.reply(`${reason} I will wait for your go-ahead.`, {
        reply_markup: reviewKeyboard(link.userId, prepared.application),
      })
    } else {
      await edit('Application ready for review.')
    }
    await sendPreview(ctx, link, prepared, chatId, formMap)
    return
  }

  if (link.autoApply) {
    const recipient =
      prepared.recipient || prepared.application.emailDraft?.to.trim()
    await edit('Ready. Applying automatically…')
    if (!recipient) {
      await saveTelegramSession(chatId, link.userId, {
        activeApplicationId: prepared.application.id,
        state: 'awaiting_email',
        pendingEmail: '',
      })
      await ctx.reply(
        `I prepared ${appName(prepared.application)} but could not find an application email. Send the address to use, or say cancel.`,
        {
          reply_markup: linksKeyboard(
            link.userId,
            prepared.application.id,
            Boolean(prepared.application.coverLetter?.text.trim()),
          ),
        },
      )
      return
    }
    await applyPrepared(ctx, link, prepared.application.id, recipient, chatId)
    return
  }

  await edit('Application ready for review.')
  await sendPreview(ctx, link, prepared, chatId)
}

async function runLinkIntake(
  ctx: Context,
  link: TelegramLinkDoc,
  user: { name: string },
  url: string,
  chatId: string,
) {
  const existing = await sessionFor(link, chatId)
  if (existing?.state === 'running') {
    await ctx.reply('I am still working on the previous application. I will message you when it is ready.')
    return
  }

  await saveTelegramSession(chatId, link.userId, {
    state: 'running',
    activeApplicationId: null,
    pendingEmail: null,
  })

  const status = await ctx.reply('Reading the linked posting…')
  const edit = async (message: string) => {
    await ctx.api
      .editMessageText(chatId, status.message_id, message)
      .catch(() => {})
  }

  try {
    const prepared = await intakeLinkApplication(link.userId, url, {
      applicantName: user.name,
      onProgress: edit,
    })
    const formMap = await mapForm(link, prepared, edit)
    await deliverPrepared(ctx, link, prepared, chatId, edit, formMap)
  } catch (error) {
    if (error instanceof LinkNotPostingError) {
      const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`
      if (classifyAts(withScheme) === null) {
        await edit('That page is not a job posting. Trying it as a link instead…')
        const github = /github\.com/i.test(withScheme) ? withScheme : null
        await handleSetLinks(ctx, link, github ? null : withScheme, github)
        await clearTelegramSession(chatId)
        return
      }
    }
    await edit(
      `I could not prepare that application: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    )
    await clearTelegramSession(chatId)
  }
}

async function handleDocument(ctx: Context, link: TelegramLinkDoc) {
  const quota = consumeRateLimit(`telegram-document:${link.userId}`, 5, 60_000)
  if (!quota.allowed) {
    await ctx.reply(
      `Too many CV uploads. Wait ${quota.retryAfter} seconds and try again.`,
    )
    return
  }
  const document = ctx.message?.document
  if (!document) return
  const name = document.file_name || ''
  if (!/\.(docx|pdf)$/i.test(name)) {
    await ctx.reply('Send your CV as a DOCX or PDF document.')
    return
  }
  if (document.file_size && document.file_size > 20 * 1024 * 1024) {
    await ctx.reply('That file is larger than 20 MB.')
    return
  }

  try {
    await ctx.reply('Reading your CV…')
    const bytes = await downloadTelegramFile(document.file_id)
    const cv = await ingestCv({
      bytes,
      fileName: name,
      contentType: document.mime_type,
    })
    await saveBaseCv(link.userId, {
      kind: cv.kind,
      fileName: cv.fileName,
      ...(cv.kind === 'docx' ? { docx: cv.docx } : {}),
      pdf: cv.pdf,
    })
    await ctx.reply(
      `Saved ${cv.fileName} as your base CV. Paste a job description whenever you are ready.`,
    )
  } catch (error) {
    await ctx.reply(
      error instanceof Error ? error.message : 'That CV could not be saved.',
    )
  }
}

async function handleStatus(ctx: Context, link: TelegramLinkDoc, chatId: string) {
  const quota = consumeRateLimit(`telegram-status:${link.userId}`, 10, 60_000)
  if (!quota.allowed) {
    await ctx.reply(
      `Too many status checks. Wait ${quota.retryAfter} seconds and try again.`,
    )
    return
  }
  const session = await sessionFor(link, chatId)
  if (!session?.activeApplicationId) {
    await ctx.reply('There is no application in progress. Paste a job description to start one.')
    return
  }
  const application = await getApplication(link.userId, session.activeApplicationId)
  const lines = [
    appName(application),
    `Stage: ${application.sentAt ? 'sent' : application.completedAt ? 'completed' : session.state.replace(/_/g, ' ')}`,
  ]
  if (application.emailDraft?.to) lines.push(`Email: ${application.emailDraft.to}`)
  if (application.coverLetter?.text) lines.push('Cover letter: ready')
  if (application.classification) {
    try {
      const pdf = await getApplicationFile(link.userId, application.id, 'pdf')
      const score = scoreRequirements(
        await extractPdfText(pdf.buffer),
        application.jdText,
        application.classification.data.requirements,
        application.classification.data.signals,
      )
      if (score.coverage !== null) {
        lines.push(`Coverage: ${score.coverage}% (${score.matched}/${score.total}).`)
      }
      if (score.gaps.length) {
        lines.push(`Missing: ${score.gaps.slice(0, 5).map((gap) => gap.term).join(', ')}.`)
      }
    } catch {
      // Status is still useful without a re-read of the PDF.
    }
  }
  await ctx.reply(lines.join('\n'), {
    reply_markup: linksKeyboard(
      link.userId,
      application.id,
      Boolean(application.coverLetter?.text.trim()),
    ),
  })
}

async function handleList(ctx: Context, link: TelegramLinkDoc) {
  const applications = (await listApplications(link.userId)).slice(0, 10)
  if (applications.length === 0) {
    await ctx.reply('No applications yet. Paste a job description to start one.')
    return
  }
  await ctx.reply(
    applications
      .map(
        (application, index) =>
          `${index + 1}. ${[application.title, application.company].filter(Boolean).join(' at ') || 'Untitled'} — ${application.sentAt ? 'sent' : application.status}`,
      )
      .join('\n'),
  )
}

async function handleHelp(ctx: Context) {
  await ctx.reply(
    [
      'I prepare and send email applications from job descriptions.',
      'Send a DOCX or PDF to set your base CV, then paste a posting.',
      'Say “looks good” to apply, or “apply automatically” to skip the preview.',
      '/auto on or /auto off controls automatic sending.',
      '/apps lists your applications, /status checks the current one.',
      'Ask me about your CV, applications, drafts, links and experience.',
    ].join('\n'),
  )
}

function formatDay(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
}

function profileUrl() {
  return `${baseUrl()}/?view=profile`
}

type TelegramUser = {
  id: string
  name: string
  email: string
  image: string | null
}

async function scopeReply(ctx: Context) {
  await ctx.reply(
    [
      'I only work on job applications here. Paste a posting and I will prepare it, send a CV document to save it as your base, or ask me about your CV, applications, drafts and links.',
      'Useful commands: /apps, /status, /auto on or /auto off, /cancel. I cannot help with code, maths or general chat.',
    ].join('\n\n'),
  )
}

async function handleCvStatus(ctx: Context, link: TelegramLinkDoc, user: TelegramUser) {
  const me = await getMe(link.userId, user)
  if (!me.cv) {
    await ctx.reply(
      'No base CV saved yet. Send your CV as a DOCX or PDF document and I will save it to your Caddie account.',
    )
    return
  }
  await ctx.reply(
    `Yes — ${me.cv.fileName} (${me.cv.kind.toUpperCase()}${me.cv.updatedAt ? `, saved ${formatDay(me.cv.updatedAt)}` : ''}). Send a new DOCX or PDF any time to replace it.`,
  )
}

async function handleAccount(ctx: Context, link: TelegramLinkDoc, user: TelegramUser) {
  const [me, sending] = await Promise.all([
    getMe(link.userId, user),
    getSending(link.userId),
  ])
  const sent = me.applications.filter((application) => application.sentAt).length
  await ctx.reply(
    [
      `${user.name || user.email} (${user.email})`,
      `CV: ${me.cv ? `${me.cv.fileName} (${me.cv.kind.toUpperCase()})` : 'none saved yet'}`,
      `Applications: ${me.applications.length} (${sent} sent)`,
      `Experience: ${me.stories.length} saved`,
      sending.hasKey
        ? `Sending: ${sending.email ?? 'address set'}${sending.verified ? `, verified${sending.domain ? ` on ${sending.domain}` : ''}` : ', not verified yet'}`
        : 'Sending: not connected — add it under Sending in Profile',
      `Auto-apply: ${me.telegram.autoApply ? 'on' : 'off'}`,
    ].join('\n'),
  )
}

async function handleExperience(ctx: Context, link: TelegramLinkDoc, query: string) {
  const stories = await listStories(link.userId)
  if (stories.length === 0) {
    await ctx.reply(
      `No experience saved yet. Add it under Experience in Profile: ${profileUrl()}`,
    )
    return
  }
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length >= 4)
  if (terms.length === 0) {
    const names = stories
      .slice(0, 5)
      .map((story) => story.title || 'Experience')
      .join(', ')
    await ctx.reply(
      `You have ${stories.length} saved: ${names}${stories.length > 5 ? ', and more' : ''}. Ask about any of them.`,
    )
    return
  }
  const matches = stories
    .map((story) => {
      const haystack =
        `${story.title ?? ''} ${story.company ?? ''} ${story.userText} ${story.skills.join(' ')}`.toLowerCase()
      const score = terms.reduce(
        (total, term) => (haystack.includes(term) ? total + 1 : total),
        0,
      )
      return { story, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
  if (matches.length === 0) {
    await ctx.reply(
      'Nothing saved about that yet. Ask about something on your CV, or add it under Experience in Profile.',
    )
    return
  }
  await ctx.reply(
    matches
      .map(
        ({ story }) =>
          `• ${[story.title || 'Experience', story.company].filter(Boolean).join(' at ')}: ${story.userText.slice(0, 280)}`,
      )
      .join('\n\n'),
  )
}

async function handleDrafts(ctx: Context, link: TelegramLinkDoc, chatId: string) {
  const session = await sessionFor(link, chatId)
  if (!session?.activeApplicationId) {
    await ctx.reply(
      'There is no application in progress. /apps lists yours — open one there first, or paste a posting to start one.',
    )
    return
  }
  const application = await getApplication(link.userId, session.activeApplicationId)
  await ctx.reply(
    [
      appName(application),
      `Letter: ${application.coverLetter?.text.trim() ? 'drafted' : 'not started yet'}`,
      application.emailDraft?.subject || application.emailDraft?.body
        ? `Email: drafted${application.emailDraft.to ? ` to ${application.emailDraft.to}` : ''}`
        : 'Email: not started yet',
      application.sentAt
        ? 'Sent.'
        : application.completedAt
          ? 'Marked done.'
          : 'Not sent.',
    ].join('\n'),
    {
      reply_markup: linksKeyboard(
        link.userId,
        application.id,
        Boolean(application.coverLetter?.text.trim()),
      ),
    },
  )
}

async function handleLinksStatus(ctx: Context, link: TelegramLinkDoc) {
  const publicWork = await getPublicWork(link.userId)
  const sources = [publicWork.website, publicWork.github].flatMap((source) =>
    source ? [source] : [],
  )
  if (sources.length === 0) {
    await ctx.reply(
      'No links saved. Send me your website or GitHub URL — for example github.com/you — and I will read what is public.',
    )
    return
  }
  await ctx.reply(
    sources
      .map((source) => {
        const kind = source.kind === 'github' ? 'GitHub' : 'Website'
        const head = `${kind}: ${source.url}`
        if (source.error) return `${head}\nCould not read it: ${source.error}`
        const read = source.readAt ? `Read ${formatDay(source.readAt)}` : 'Saved, not read yet'
        const summary = [source.headline, source.summary]
          .filter(Boolean)
          .join(' — ')
          .slice(0, 200)
        const projects = source.projects
          .slice(0, 3)
          .map((project) => project.name)
          .join(', ')
        return [head, read, summary, projects ? `Projects: ${projects}` : '']
          .filter(Boolean)
          .join('\n')
      })
      .join('\n\n'),
  )
}

async function handleSetLinks(
  ctx: Context,
  link: TelegramLinkDoc,
  website: string | null,
  github: string | null,
) {
  const quota = consumeRateLimit(`telegram-links:${link.userId}`, 3, 60_000)
  if (!quota.allowed) {
    await ctx.reply(
      `Too many link updates. Wait ${quota.retryAfter} seconds and try again.`,
    )
    return
  }
  const current = await getPublicWork(link.userId)
  const next = {
    website: website ?? current.website?.url ?? null,
    github: github ?? current.github?.url ?? null,
  }
  if (!next.website && !next.github) {
    await ctx.reply(
      'Send me a website or GitHub URL and I will save and read it — for example github.com/you.',
    )
    return
  }
  await ctx.reply('Reading your links…')
  try {
    const publicWork = await savePublicWork(link.userId, next)
    const parts = [publicWork.website, publicWork.github]
      .flatMap((source) => (source ? [source] : []))
      .map((source) => {
        const kind = source.kind === 'github' ? 'GitHub' : 'Website'
        if (source.error) return `${kind}: saved, but reading failed — ${source.error}`
        const count = source.projects.length
        return `${kind}: ${count} project${count === 1 ? '' : 's'} read.`
      })
    await ctx.reply([next.website && next.github ? 'Saved both links.' : 'Saved.', ...parts].join('\n'))
  } catch (error) {
    await ctx.reply(
      error instanceof Error ? error.message : 'Those links could not be saved.',
    )
  }
}

async function handleWebsiteOnly(
  ctx: Context,
  action: 'credentials' | 'delete' | 'settings' | 'other',
  topic: string,
) {
  const url = profileUrl()
  if (action === 'credentials') {
    await ctx.reply(
      `I never take keys here, so please do not paste them in chat. Add your Resend key under Sending in Profile: ${url}`,
    )
    return
  }
  if (/cv|resume/.test(topic)) {
    await ctx.reply(
      `To remove your CV, do it under CV in Profile: ${url}\nTo replace it, just send a new DOCX or PDF document here.`,
    )
    return
  }
  if (action === 'delete') {
    await ctx.reply(`I do not delete things from chat. Do that on the website: ${url}`)
    return
  }
  await ctx.reply(`That change happens on the website: ${url}`)
}

export function createTelegramBot(token: string) {
  const bot = new Bot(token)

  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') {
      if (ctx.chat.type !== 'channel') {
        await ctx.reply('Use Caddie in a private chat so applications stay scoped to your account.')
      }
      return
    }
    if (ctx.from && ctx.chat && ctx.from.id !== ctx.chat.id) {
      await ctx.reply('Use Caddie in a private chat so applications stay scoped to your account.')
      return
    }
    await next()
  })

  bot.command('start', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    const user = await telegramUser(link)
    const me = user ? await getMe(link.userId, user) : null
    const name = displayName(link)
    if (!me?.cv) {
      await ctx.reply(
        `Welcome, ${name}. Send your CV as a DOCX or PDF document and I will save it to your Caddie account.`,
      )
      return
    }
    await ctx.reply(
      `Welcome back, ${name}. Paste a job description and I will prepare the application, or send a new CV to replace your base CV.`,
    )
  })

  bot.command('help', async (ctx) => handleHelp(ctx))
  bot.command('cancel', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    await clearTelegramSession(String(ctx.chat.id))
    await ctx.reply('Stopped. Send a job description when you want to start again.')
  })
  bot.command('apps', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    await handleList(ctx, link)
  })
  bot.command('status', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    await handleStatus(ctx, link, String(ctx.chat.id))
  })
  bot.command('auto', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    const value = (ctx.match ?? '').trim().toLowerCase()
    if (value !== 'on' && value !== 'off') {
      await ctx.reply('Use /auto on or /auto off.')
      return
    }
    await setTelegramAuto(String(ctx.chat.id), value === 'on')
    await ctx.reply(
      value === 'on'
        ? 'Auto-apply is on. New applications will be sent after preparation when an email and sending identity are available.'
        : 'Auto-apply is off. I will show you each application before sending.',
    )
  })

  bot.on('message:document', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    await handleDocument(ctx, link)
  })

  bot.on('message:text', async (ctx) => {
    const link = await requireLink(ctx)
    if (!link) return
    const chatId = String(ctx.chat.id)
    const user = await telegramUser(link)
    if (!user) {
      await ctx.reply('Your Caddie account could not be found. Disconnect and connect Telegram again.')
      return
    }
    const session = await sessionFor(link, chatId)
    if (session?.state === 'running') {
      await ctx.reply('I am still working on the current application. I will message you when it is ready.')
      return
    }

    const text = ctx.message.text.trim()
    if (!text) return
    if (session?.state === 'awaiting_email') {
      const value = text.trim()
      const email = value.match(
        /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
      )?.[0]
      const address = value
        .replace(/^(?:use|send to|send it to|email|my email is)\s+/i, '')
        .trim()
      if (
        email &&
        address.toLowerCase() === email.toLowerCase() &&
        session.activeApplicationId
      ) {
        await saveTelegramSession(chatId, link.userId, { pendingEmail: email })
        await applyPrepared(ctx, link, session.activeApplicationId, email, chatId)
        return
      }
      if (/^cancel$/i.test(text)) {
        await clearTelegramSession(chatId)
        await ctx.reply('Cancelled.')
        return
      }
      await ctx.reply(
        'Send only the email address to use, or say cancel.',
      )
      return
    }

    const routerQuota = consumeRateLimit(
      `telegram-router:${link.userId}`,
      20,
      60_000,
    )
    if (!routerQuota.allowed) {
      await ctx.reply(
        `Too many requests. Wait ${routerQuota.retryAfter} seconds and try again.`,
      )
      return
    }

    if (isBareLink(text)) {
      const me = await getMe(link.userId, user)
      if (!me.cv) {
        await ctx.reply('Send your CV as a DOCX or PDF document first.')
        return
      }
      await remember(chatId, link, session, text, 'Reading the linked posting.')
      await runLinkIntake(ctx, link, user, text, chatId)
      return
    }

    const intent = await routeTelegramText({
      text,
      active: Boolean(session?.activeApplicationId),
      state: session?.state ?? 'idle',
      history: session?.history ?? [],
    })

    if (intent.type === 'new_application') {
      const me = await getMe(link.userId, user)
      if (!me.cv) {
        await ctx.reply('Send your CV as a DOCX or PDF document first.')
        return
      }
      await remember(chatId, link, session, text, 'Preparing the application.')
      await runIntake(ctx, link, user, intent.text, chatId)
      return
    }

    if (intent.type === 'approve') {
      if (
        !session?.activeApplicationId ||
        session.state !== 'awaiting_approval'
      ) {
        await ctx.reply('There is no prepared application waiting for approval.')
        return
      }
      await applyPrepared(ctx, link, session.activeApplicationId, undefined, chatId)
      return
    }

    if (intent.type === 'cancel') {
      await clearTelegramSession(chatId)
      await ctx.reply('Stopped. Send a job description when you want to start again.')
      return
    }

    if (intent.type === 'status') {
      await handleStatus(ctx, link, chatId)
      return
    }

    if (intent.type === 'list_applications') {
      await handleList(ctx, link)
      return
    }

    if (intent.type === 'auto_on') {
      await setTelegramAuto(chatId, true)
      if (
        session?.activeApplicationId &&
        session.state === 'awaiting_approval'
      ) {
        await applyPrepared(
          ctx,
          link,
          session.activeApplicationId,
          undefined,
          chatId,
        )
      } else {
        await ctx.reply(
          'Auto-apply is on. New applications will send without a preview when possible.',
        )
      }
      return
    }

    if (intent.type === 'auto_off') {
      await setTelegramAuto(chatId, false)
      await ctx.reply('Auto-apply is off. I will show you each application before sending.')
      return
    }

    if (intent.type === 'select_application') {
      const applications = await listApplications(link.userId)
      const query = intent.query.toLowerCase()
      const match = applications.find((application) =>
        [application.title, application.company]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
      )
      if (!match) {
        await ctx.reply(`I could not find an application matching “${intent.query}”.`)
        return
      }
      await saveTelegramSession(chatId, link.userId, {
        activeApplicationId: match.id,
        state: 'awaiting_approval',
      })
      await handleStatus(ctx, link, chatId)
      return
    }

    if (intent.type === 'cv_status') {
      await handleCvStatus(ctx, link, user)
      return
    }

    if (intent.type === 'account') {
      await handleAccount(ctx, link, user)
      return
    }

    if (intent.type === 'experience') {
      await handleExperience(ctx, link, intent.query)
      return
    }

    if (intent.type === 'drafts') {
      await handleDrafts(ctx, link, chatId)
      return
    }

    if (intent.type === 'links_status') {
      await handleLinksStatus(ctx, link)
      return
    }

    if (intent.type === 'set_links') {
      await handleSetLinks(ctx, link, intent.website, intent.github)
      return
    }

    if (intent.type === 'website_only') {
      await handleWebsiteOnly(ctx, intent.action, intent.topic)
      return
    }

    if (intent.type === 'out_of_scope') {
      await scopeReply(ctx)
      return
    }

    if (intent.type === 'help') {
      await handleHelp(ctx)
      return
    }

    if (intent.type === 'smalltalk') {
      await ctx.reply(intent.reply)
      return
    }

    await scopeReply(ctx)
  })

  bot.on('callback_query:data', async (ctx) => {
    const link = await telegramLinkForChat(String(ctx.chat?.id))
    if (!link || !ctx.chat) {
      await ctx.answerCallbackQuery({ text: 'Connect Telegram first.' })
      return
    }
    const [action, applicationId] = ctx.callbackQuery.data.split(':')
    if (!applicationId || !['apply', 'cancel'].includes(action)) {
      await ctx.answerCallbackQuery()
      return
    }
    await ctx.answerCallbackQuery()
    if (action === 'cancel') {
      await clearTelegramSession(String(ctx.chat.id))
      await ctx.reply('Cancelled. The application was not sent.')
      return
    }
    await applyPrepared(ctx, link, applicationId, undefined, String(ctx.chat.id))
  })

  bot.catch((error) => {
    console.error('[telegram] update failed', {
      message: error.message,
      error: error.error instanceof Error ? error.error.message : undefined,
    })
    void error.ctx
      .reply('Something went wrong while handling that. Try again or send /cancel.')
      .catch(() => {})
  })

  return bot
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) {
    throw new TelegramApiError(
      'Telegram is not configured. Add TELEGRAM_BOT_TOKEN to .env.local.',
      503,
    )
  }
  const bot = createTelegramBot(token)
  await bot.start({
    onStart: (me) => console.log(`[telegram] @${me.username} is listening`),
  })
}
