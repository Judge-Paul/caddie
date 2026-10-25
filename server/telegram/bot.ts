import { Bot, InlineKeyboard, type Context } from 'grammy'

import type { ApplicationDetail } from '../../shared/account'
import { findApplicationEmail } from '../../shared/application-email'
import { prepareApplication, type PreparedApplication } from '../application-pipeline'
import {
  AccountError,
  getApplication,
  getApplicationFile,
  getMe,
  listApplications,
  saveBaseCv,
} from '../account'
import { extractPdfText } from '../cv/text'
import { scoreRequirements } from '../../src/lib/match'
import { sendApplication } from '../send'
import { ingestCv } from '../cv/ingest'
import { createPreviewToken } from '../preview-token'
import { consumeRateLimit } from '../rate-limit'
import { TelegramApiError, downloadTelegramFile } from './api'
import {
  telegramLinkForChat,
  telegramLinkUrl,
  setTelegramAuto,
  updateTelegramIdentity,
  type TelegramLinkDoc,
} from './links'
import { routeTelegramText } from './router'
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

async function sendPreview(
  ctx: Context,
  link: TelegramLinkDoc,
  prepared: PreparedApplication,
  chatId: string,
) {
  const application = prepared.application
  const recipient =
    prepared.recipient || application.emailDraft?.to.trim() || null
  const email = application.emailDraft
  const message = [
    `${appName(application)}`,
    scoreLine(prepared),
    prepared.cvNote,
    gapsLine(prepared),
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
  } catch (error) {
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
      'I can prepare and send an email application from a job description.',
      'Send a DOCX or PDF to set your base CV, then paste a posting.',
      'Say “looks good” to apply, or “apply automatically” to skip the preview.',
      '/auto on or /auto off controls automatic sending.',
      '/apps lists your applications, /status checks the current one.',
    ].join('\n'),
  )
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

    if (intent.type === 'help') {
      await handleHelp(ctx)
      return
    }

    if (intent.type === 'smalltalk') {
      await ctx.reply(intent.reply)
      return
    }

    await ctx.reply(
      'I can prepare an application from a pasted job description, save a CV document, list applications, or apply a prepared one. What would you like to do?',
    )
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
